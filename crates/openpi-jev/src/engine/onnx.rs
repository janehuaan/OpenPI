use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{anyhow, Result};
use ort::session::Session;
use ort::value::Tensor;
use tokio::sync::Mutex;
use tokenizers::Tokenizer;

use crate::types::{JevAnswer, JevQuestion, JevRequest, JevResponse};

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

    /// Run single forward pass to get pooled sentence representation (mean pooling over last hidden state)
    async fn embed_text(&self, text: &str) -> Result<Vec<f32>> {
        let ids = self.encode_tokens(text, 512)?;
        let seq_len = ids.len();
        let attention_mask: Vec<i64> = vec![1; seq_len];

        let shape = [1usize, seq_len];
        let input_ids_tensor = Tensor::from_array((shape, ids))
            .map_err(|e| anyhow!("ort tensor input_ids failed: {e}"))?;
        let attention_mask_tensor = Tensor::from_array((shape, attention_mask))
            .map_err(|e| anyhow!("ort tensor attention_mask failed: {e}"))?;

        let mut sess = self.session.lock().await;
        let outputs = sess
            .run(ort::inputs![
                "input_ids" => input_ids_tensor,
                "attention_mask" => attention_mask_tensor,
            ])
            .map_err(|e| anyhow!("ort run failed: {e}"))?;

        // In ort 2.0.0-rc.x, `try_extract_tensor` yields `(&Shape, &[T])`.
        let (_shape, data) = outputs[0]
            .try_extract_tensor::<f32>()
            .map_err(|e| anyhow!("ort extract tensor failed: {e}"))?;

        let hidden_dim = data.len() / seq_len;
        if hidden_dim == 0 {
            return Err(anyhow!("Invalid tensor output dimension"));
        }

        // Mean pooling over tokens to produce a robust dense sentence representation
        let mut pooled = vec![0.0f32; hidden_dim];
        for t in 0..seq_len {
            let offset = t * hidden_dim;
            for d in 0..hidden_dim {
                pooled[d] += data[offset + d];
            }
        }
        let inv_len = 1.0 / (seq_len as f32);
        for d in 0..hidden_dim {
            pooled[d] *= inv_len;
        }

        Ok(pooled)
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

    /// Evaluates the Jev request against the ONNX model using semantic pointer projection
    pub async fn evaluate(&self, req: &JevRequest) -> Result<JevResponse> {
        let mut answers = Vec::with_capacity(req.questions.len());

        for question in &req.questions {
            match question {
                JevQuestion::Choice { id, instructions, options } => {
                    let context_prompt = format!("Context:\n{}\nQuestion: {}", req.state, instructions);
                    let context_emb = self.embed_text(&context_prompt).await?;

                    let mut best_opt = options.first().cloned().unwrap_or_default();
                    let mut max_sim = -2.0f32;

                    for opt in options {
                        let opt_emb = self.embed_text(opt).await?;
                        let sim = Self::cosine_similarity(&context_emb, &opt_emb);
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
                JevQuestion::Noul { id, instructions } => {
                    let context_prompt = format!("Context:\n{}\nQuestion: {}", req.state, instructions);
                    let context_emb = self.embed_text(&context_prompt).await?;

                    let yes_emb = self.embed_text("Yes, affirmed, true, confirmed.").await?;
                    let no_emb = self.embed_text("No, negative, false, rejected.").await?;

                    let sim_yes = Self::cosine_similarity(&context_emb, &yes_emb);
                    let sim_no = Self::cosine_similarity(&context_emb, &no_emb);

                    let is_yes = sim_yes >= sim_no;
                    let prob = ((sim_yes - sim_no + 1.0) / 2.0).clamp(0.0, 1.0);

                    answers.push(JevAnswer {
                        id: id.clone(),
                        value: serde_json::Value::Bool(is_yes),
                        confidence: prob,
                        distribution: None,
                    });
                }
                JevQuestion::Score { id, instructions, levels } => {
                    let context_prompt = format!("Context:\n{}\nQuestion: {}", req.state, instructions);
                    let context_emb = self.embed_text(&context_prompt).await?;

                    // Project the context against the caller-provided ordered levels;
                    // the best-matching level maps to a normalized [0, 1] score.
                    let n = levels.len();
                    let mut best_idx = 0usize;
                    let mut best_sim = -2.0f32;
                    for (i, lvl) in levels.iter().enumerate() {
                        let lvl_emb = self.embed_text(lvl).await?;
                        let sim = Self::cosine_similarity(&context_emb, &lvl_emb);
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
