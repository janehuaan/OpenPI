use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{anyhow, Result};
use ort::session::Session;
use ort::value::Tensor;
use tokio::sync::Mutex;
use tokenizers::Tokenizer;

use crate::types::{JevAnswer, JevQuestion, JevRequest, JevResponse};

/// Constant anchors used by `Noul` questions. They are embedded once per request
/// alongside the other candidates rather than on every question.
const YES_ANCHOR: &str = "Yes, affirmed, true, confirmed.";
const NO_ANCHOR: &str = "No, negative, false, rejected.";

const MAX_TOKENS: usize = 512;

/// Native Rust ONNX Verdict Engine running local ModernBERT INT8
pub struct LocalVerdictEngine {
    session: Arc<Mutex<Session>>,
    tokenizer: Tokenizer,
}

impl LocalVerdictEngine {
    /// Attempts to load engine from ~/.openpi/models/verdict or custom path
    pub fn try_load_default() -> Result<Self> {
        let home = std::env::var("HOME").map_err(|_| anyhow!("HOME not set"))?;
        let model_dir = PathBuf::from(home).join(".openpi").join("models").join("verdict");
        Self::load_from_dir(&model_dir)
    }

    pub fn load_from_dir(dir: &Path) -> Result<Self> {
        let model_path = dir.join("model_int8.onnx");
        let tokenizer_path = dir.join("tokenizer.json");

        if !model_path.exists() || !tokenizer_path.exists() {
            return Err(anyhow!("Model or tokenizer missing in {:?}", dir));
        }

        let tokenizer = Tokenizer::from_file(&tokenizer_path)
            .map_err(|e| anyhow!("Failed to load tokenizer: {}", e))?;

        // NOTE: `ort` resolves to a 2.0.0-rc.x build whose builder error type is
        // `ort::Error<SessionBuilder>`; that payload is not Send + Sync, so it
        // cannot be converted with `?` into a Send + Sync error box. Convert anyhow.
        let session = Session::builder()
            .map_err(|e| anyhow!("ort session builder failed: {e}"))?
            .with_intra_threads(2)
            .map_err(|e| anyhow!("ort intra_threads failed: {e}"))?
            .commit_from_file(&model_path)
            .map_err(|e| anyhow!("ort commit_from_file failed: {e}"))?;

        Ok(Self {
            session: Arc::new(Mutex::new(session)),
            tokenizer,
        })
    }

    /// Internal helper: encode text into token ids (truncated to max_len)
    fn encode_tokens(&self, text: &str, max_len: usize) -> Result<Vec<i64>> {
        let encoding = self
            .tokenizer
            .encode(text, true)
            .map_err(|e| anyhow!("Tokenization failed: {}", e))?;
        let mut ids: Vec<i64> = encoding.get_ids().iter().map(|&id| id as i64).collect();
        if ids.len() > max_len {
            ids.truncate(max_len);
        }
        if ids.is_empty() {
            ids.push(0);
        }
        Ok(ids)
    }

    /// Embed a batch of texts in a *single* forward pass, mean-pooling each row
    /// over its own token count. One pass per batch instead of one per text.
    async fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        let batch = texts.len();
        let mut rows: Vec<Vec<i64>> = Vec::with_capacity(batch);
        for text in texts {
            rows.push(self.encode_tokens(text, MAX_TOKENS)?);
        }
        let max_len = rows.iter().map(|r| r.len()).max().unwrap_or(1);
        let mut input_ids = vec![0i64; batch * max_len];
        let mut attention_mask = vec![0i64; batch * max_len];
        let mut lengths = vec![0usize; batch];
        for (i, row) in rows.iter().enumerate() {
            lengths[i] = row.len();
            for (j, id) in row.iter().enumerate() {
                input_ids[i * max_len + j] = *id;
                attention_mask[i * max_len + j] = 1;
            }
        }

        let shape = [batch, max_len];
        let ids_tensor = Tensor::from_array((shape, input_ids))
            .map_err(|e| anyhow!("ort tensor input_ids failed: {e}"))?;
        let mask_tensor = Tensor::from_array((shape, attention_mask))
            .map_err(|e| anyhow!("ort tensor attention_mask failed: {e}"))?;

        // `Session::run` is a blocking CPU call, so it runs on the blocking pool
        // instead of stalling the async runtime while the lock is held.
        let guard = self.session.clone().lock_owned().await;
        let (pooled, hidden_dim) = tokio::task::spawn_blocking(
            move || -> Result<(Vec<f32>, usize)> {
                let mut session = guard;
                let outputs = session
                    .run(ort::inputs![
                        "input_ids" => ids_tensor,
                        "attention_mask" => mask_tensor,
                    ])
                    .map_err(|e| anyhow!("ort run failed: {e}"))?;

                // In ort 2.0.0-rc.x, `try_extract_tensor` yields `(&Shape, &[T])`.
                let (_shape, data) = outputs[0]
                    .try_extract_tensor::<f32>()
                    .map_err(|e| anyhow!("ort extract tensor failed: {e}"))?;

                let hidden = data.len() / (batch * max_len);
                if hidden == 0 {
                    return Err(anyhow!("Invalid tensor output dimension"));
                }

                // Mean pooling over real tokens only; padding positions are skipped.
                let mut pooled = Vec::with_capacity(batch * hidden);
                for i in 0..batch {
                    let len = lengths[i].max(1);
                    let row = i * max_len;
                    for d in 0..hidden {
                        let mut sum = 0.0f32;
                        for j in 0..len {
                            sum += data[(row + j) * hidden + d];
                        }
                        pooled.push(sum / len as f32);
                    }
                }
                Ok((pooled, hidden))
            },
        )
        .await
        .map_err(|e| anyhow!("embedding task failed: {e}"))??;

        Ok(pooled.chunks(hidden_dim).map(|row| row.to_vec()).collect())
    }

    /// Embed every distinct text once, returning a lookup keyed by text.
    async fn embed_unique<'a>(&self, texts: &'a [String]) -> Result<HashMap<&'a str, Vec<f32>>> {
        let mut unique: Vec<&str> = Vec::with_capacity(texts.len());
        for text in texts {
            if !unique.iter().any(|seen| *seen == text.as_str()) {
                unique.push(text.as_str());
            }
        }
        let owned: Vec<String> = unique.iter().map(|t| t.to_string()).collect();
        let vectors = self.embed_batch(&owned).await?;
        Ok(unique.into_iter().zip(vectors).collect())
    }

    /// Calculate cosine similarity between two dense vectors
    fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
        if a.len() != b.len() || a.is_empty() {
            return 0.0;
        }
        let mut dot = 0.0f32;
        let mut norm_a = 0.0f32;
        let mut norm_b = 0.0f32;
        for i in 0..a.len() {
            dot += a[i] * b[i];
            norm_a += a[i] * a[i];
            norm_b += b[i] * b[i];
        }
        let denom = norm_a.sqrt() * norm_b.sqrt();
        if denom < 1e-9 {
            0.0
        } else {
            (dot / denom).clamp(-1.0, 1.0)
        }
    }

    /// Evaluates the Jev request against the ONNX model using semantic pointer projection.
    ///
    /// All the text this request needs is embedded up front — every context prompt
    /// and every candidate (options, levels, yes/no anchors) — so identical text is
    /// encoded once and the candidates share a single forward pass.
    pub async fn evaluate(&self, req: &JevRequest) -> Result<JevResponse> {
        let mut answers = Vec::with_capacity(req.questions.len());

        let mut contexts: Vec<String> = Vec::with_capacity(req.questions.len());
        let mut candidates: Vec<String> = vec![YES_ANCHOR.to_string(), NO_ANCHOR.to_string()];
        for question in &req.questions {
            contexts.push(context_prompt(&req.state, question));
            match question {
                JevQuestion::Choice { options, .. } => candidates.extend(options.iter().cloned()),
                JevQuestion::Score { levels, .. } => candidates.extend(levels.iter().cloned()),
                JevQuestion::Noul { .. } => {}
            }
        }

        let context_vectors = self.embed_unique(&contexts).await?;
        let candidate_vectors = self.embed_unique(&candidates).await?;

        for (index, question) in req.questions.iter().enumerate() {
            let Some(context_emb) = context_vectors.get(contexts[index].as_str()) else {
                continue;
            };

            match question {
                JevQuestion::Choice { id, options, .. } => {
                    let mut best_opt = options.first().cloned().unwrap_or_default();
                    let mut max_sim = -2.0f32;
                    for opt in options {
                        let Some(opt_emb) = candidate_vectors.get(opt.as_str()) else {
                            continue;
                        };
                        let sim = Self::cosine_similarity(context_emb, opt_emb);
                        if sim > max_sim {
                            max_sim = sim;
                            best_opt = opt.clone();
                        }
                    }
                    let confidence = ((max_sim + 1.0) / 2.0).clamp(0.0, 1.0);
                    answers.push(JevAnswer {
                        id: id.clone(),
                        value: serde_json::Value::String(best_opt),
                        confidence,
                        distribution: None,
                    });
                }
                JevQuestion::Noul { id, .. } => {
                    let yes_sim = candidate_vectors
                        .get(YES_ANCHOR)
                        .map(|emb| Self::cosine_similarity(context_emb, emb))
                        .unwrap_or(0.0);
                    let no_sim = candidate_vectors
                        .get(NO_ANCHOR)
                        .map(|emb| Self::cosine_similarity(context_emb, emb))
                        .unwrap_or(0.0);

                    let is_yes = yes_sim >= no_sim;
                    let prob = ((yes_sim - no_sim + 1.0) / 2.0).clamp(0.0, 1.0);
                    answers.push(JevAnswer {
                        id: id.clone(),
                        value: serde_json::Value::Bool(is_yes),
                        confidence: prob,
                        distribution: None,
                    });
                }
                JevQuestion::Score { id, levels, .. } => {
                    // Project the context against the caller-provided ordered levels;
                    // the best-matching level maps to a normalized [0, 1] score.
                    let n = levels.len();
                    let mut best_idx = 0usize;
                    let mut best_sim = -2.0f32;
                    for (i, level) in levels.iter().enumerate() {
                        let Some(level_emb) = candidate_vectors.get(level.as_str()) else {
                            continue;
                        };
                        let sim = Self::cosine_similarity(context_emb, level_emb);
                        if sim > best_sim {
                            best_sim = sim;
                            best_idx = i;
                        }
                    }
                    let score = if n > 1 { best_idx as f32 / (n - 1) as f32 } else { 0.5 };
                    let confidence = ((best_sim + 1.0) / 2.0).clamp(0.0, 1.0);
                    answers.push(JevAnswer {
                        id: id.clone(),
                        value: serde_json::Value::Number(
                            serde_json::Number::from_f64(score as f64)
                                .unwrap_or(serde_json::Number::from(0)),
                        ),
                        confidence,
                        distribution: None,
                    });
                }
            }
        }

        Ok(JevResponse { answers })
    }
}

fn instructions_of(question: &JevQuestion) -> &str {
    match question {
        JevQuestion::Choice { instructions, .. }
        | JevQuestion::Noul { instructions, .. }
        | JevQuestion::Score { instructions, .. } => instructions,
    }
}

fn context_prompt(state: &str, question: &JevQuestion) -> String {
    format!("Context:\n{}\nQuestion: {}", state, instructions_of(question))
}
