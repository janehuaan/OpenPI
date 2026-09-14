pub mod bm25;
pub mod vector;

use serde::{Deserialize, Serialize};
pub use bm25::Bm25Index;
pub use vector::cosine_similarity;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryDoc {
    pub id: String,
    pub content: String,
    pub vector: Option<Vec<f32>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HybridHit {
    pub id: String,
    pub score: f32,
    pub vector_score: f32,
    pub bm25_score: f32,
}

pub struct HybridSearchEngine {
    docs: Vec<MemoryDoc>,
    bm25: Bm25Index,
}

impl HybridSearchEngine {
    pub fn build(docs: Vec<MemoryDoc>) -> Self {
        let texts: Vec<String> = docs.iter().map(|d| d.content.clone()).collect();
        let bm25 = Bm25Index::new(&texts);
        Self { docs, bm25 }
    }

    pub fn search(
        &self,
        query: &str,
        query_vector: Option<&[f32]>,
        limit: usize,
        alpha: f32, // weight for vector score [0.0 = pure bm25, 1.0 = pure vector]
    ) -> Vec<HybridHit> {
        let bm25_scores = self.bm25.score(query);
        let max_bm25 = bm25_scores.iter().copied().fold(0.0f32, f32::max);

        let mut hits = Vec::with_capacity(self.docs.len());

        for (idx, doc) in self.docs.iter().enumerate() {
            let normalized_bm25 = if max_bm25 > 1e-5 {
                bm25_scores[idx] / max_bm25
            } else {
                0.0
            };

            let vec_score = match (query_vector, &doc.vector) {
                (Some(qv), Some(dv)) => cosine_similarity(qv, dv),
                _ => 0.0,
            };

            let final_score = if query_vector.is_some() {
                alpha * vec_score + (1.0 - alpha) * normalized_bm25
            } else {
                normalized_bm25
            };

            hits.push(HybridHit {
                id: doc.id.clone(),
                score: final_score,
                vector_score: vec_score,
                bm25_score: bm25_scores[idx],
            });
        }

        hits.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        hits.truncate(limit);
        hits
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bm25_and_hybrid_search() {
        let docs = vec![
            MemoryDoc {
                id: "doc1".into(),
                content: "OpenPI is an autonomous coding workbench built with Electron and Rust".into(),
                vector: Some(vec![1.0, 0.0, 0.0]),
            },
            MemoryDoc {
                id: "doc2".into(),
                content: "React and Monaco editor provide the user interface".into(),
                vector: Some(vec![0.0, 1.0, 0.0]),
            },
            MemoryDoc {
                id: "doc3".into(),
                content: "Rust provides fast memory and scheduling performance".into(),
                vector: Some(vec![0.5, 0.5, 0.0]),
            },
        ];

        let engine = HybridSearchEngine::build(docs);
        let hits = engine.search("Rust performance", None, 2, 0.5);
        assert!(!hits.is_empty());
        assert_eq!(hits[0].id, "doc3");

        let vec_query = vec![1.0, 0.0, 0.0];
        let hybrid_hits = engine.search("workbench", Some(&vec_query), 2, 0.7);
        assert!(!hybrid_hits.is_empty());
        assert_eq!(hybrid_hits[0].id, "doc1");
    }
}
