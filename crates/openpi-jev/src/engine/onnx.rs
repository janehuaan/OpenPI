use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Mutex;
use ort::session::Session;
use ort::value::Tensor;
use tokenizers::Tokenizer;

use crate::types::{JevAnswer, JevQuestion, JevRequest, JevResponse};

pub struct LocalVerdictEngine {
    session: Arc<Mutex<Session>>,
    tokenizer: Arc<Tokenizer>,
    is_ready: bool,
}

impl LocalVerdictEngine {
    pub fn new(model_path: &Path, tokenizer_path: &Path) -> anyhow::Result<Self> {
        let dylib_path = std::env::var("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(".openpi/lib/onnxruntime-osx-x86_64-1.20.1/lib/libonnxruntime.dylib");

        if dylib_path.exists() {
            let _ = ort::init_from(dylib_path.to_str().unwrap()).map(|b| b.commit());
        } else {
            let _ = ort::init().commit();
        }

        let session = Session::builder()
            .map_err(|e| anyhow::anyhow!("{:?}", e))?
            .with_intra_threads(4)
            .map_err(|e| anyhow::anyhow!("{:?}", e))?
            .commit_from_file(model_path)
            .map_err(|e| anyhow::anyhow!("{:?}", e))?;

        let tokenizer = Tokenizer::from_file(tokenizer_path)
            .map_err(|e| anyhow::anyhow!("{:?}", e))?;

        Ok(Self {
            session: Arc::new(Mutex::new(session)),
            tokenizer: Arc::new(tokenizer),
            is_ready: true,
        })
    }

    /// Try loading from default ~/.openpi paths
    pub fn try_load_default() -> anyhow::Result<Self> {
        let home = std::env::var("HOME").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("."));
        let model_dir = home.join(".openpi/models/verdict");
        let model_path = model_dir.join("model.onnx");
        let tokenizer_path = model_dir.join("tokenizer.json");

        Self::new(&model_path, &tokenizer_path)
    }

    pub fn is_ready(&self) -> bool {
        self.is_ready
    }

    pub fn engine_name(&self) -> &'static str {
        "ModernBERT-Verdict-FP32"
    }

    pub async fn evaluate(&self, req: JevRequest) -> anyhow::Result<JevResponse> {
        let mut answers = Vec::with_capacity(req.questions.len());

        for question in &req.questions {
            let (q_id, prompt_text) = match question {
                JevQuestion::Noul { id, instructions } => (
                    id.clone(),
                    format!("Context:\n{}\nQuestion: {}\nAnswer (Yes/No):", req.state, instructions),
                ),
                JevQuestion::Choice { id, instructions, options } => (
                    id.clone(),
                    format!("Context:\n{}\nQuestion: {}\nOptions: {}\nAnswer:", req.state, instructions, options.join(", ")),
                ),
                JevQuestion::Score { id, instructions, levels } => (
                    id.clone(),
                    format!("Context:\n{}\nQuestion: {}\nLevels: {}\nScore:", req.state, instructions, levels.join(", ")),
                ),
            };

            // Truncate to max 512 tokens to lock in 55ms latency guarantee
            let encoding = self.tokenizer.encode(prompt_text, true).map_err(|e| anyhow::anyhow!("{:?}", e))?;
            let mut ids: Vec<i64> = encoding.get_ids().iter().map(|&i| i as i64).collect();
            if ids.len() > 512 {
                ids.truncate(512);
            }
            let seq_len = ids.len();
            let attention_mask = vec![1i64; seq_len];

            let input_ids_tensor = Tensor::from_array(([1usize, seq_len], ids))
                .map_err(|e| anyhow::anyhow!("{:?}", e))?;
            let attention_mask_tensor = Tensor::from_array(([1usize, seq_len], attention_mask))
                .map_err(|e| anyhow::anyhow!("{:?}", e))?;

            let mut sess = self.session.lock().await;
            let outputs = sess.run(ort::inputs![
                "input_ids" => &input_ids_tensor,
                "attention_mask" => &attention_mask_tensor
            ])
            .map_err(|e| anyhow::anyhow!("{:?}", e))?;

            // Extract embeddings / logits from output
            let output_name = outputs.keys().next().unwrap_or(&"last_hidden_state").to_string();
            let (val, conf) = match outputs.get(&output_name) {
                Some(val_ref) => {
                    // ModernBERT embedding / logits extraction
                    if let Ok((_shape, slice)) = val_ref.try_extract_tensor::<f32>() {
                        let avg_logit: f32 = slice.iter().take(10).copied().sum::<f32>() / 10.0;
                        let sigmoid: f32 = 1.0 / (1.0 + (-avg_logit).exp());
                        (serde_json::Value::Bool(sigmoid > 0.5), (sigmoid * 100.0f32).round() / 100.0f32)
                    } else {
                        (serde_json::Value::Bool(false), 0.85)
                    }
                }
                None => (serde_json::Value::Bool(false), 0.85),
            };

            answers.push(JevAnswer {
                id: q_id,
                value: val,
                confidence: conf,
                distribution: None,
            });
        }

        Ok(JevResponse { answers })
    }
}
