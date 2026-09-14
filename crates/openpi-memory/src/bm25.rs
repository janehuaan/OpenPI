use std::collections::{HashMap, HashSet};

pub fn tokenize(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric() && c != '_' && c != '-')
        .filter(|t| !t.is_empty())
        .map(|s| s.to_string())
        .collect()
}

pub struct Bm25Index {
    doc_count: usize,
    avg_doc_len: f32,
    doc_lens: Vec<usize>,
    term_doc_freqs: HashMap<String, usize>,
    doc_term_freqs: Vec<HashMap<String, usize>>,
}

impl Bm25Index {
    pub fn new(docs: &[String]) -> Self {
        let doc_count = docs.len();
        let mut doc_lens = Vec::with_capacity(doc_count);
        let mut total_len = 0;
        let mut term_doc_freqs: HashMap<String, usize> = HashMap::new();
        let mut doc_term_freqs = Vec::with_capacity(doc_count);

        for doc in docs {
            let tokens = tokenize(doc);
            let len = tokens.len();
            doc_lens.push(len);
            total_len += len;

            let mut tf = HashMap::new();
            let mut unique_terms = HashSet::new();

            for token in tokens {
                *tf.entry(token.clone()).or_insert(0) += 1;
                unique_terms.insert(token);
            }

            for term in unique_terms {
                *term_doc_freqs.entry(term).or_insert(0) += 1;
            }

            doc_term_freqs.push(tf);
        }

        let avg_doc_len = if doc_count > 0 {
            total_len as f32 / doc_count as f32
        } else {
            0.0
        };

        Self {
            doc_count,
            avg_doc_len,
            doc_lens,
            term_doc_freqs,
            doc_term_freqs,
        }
    }

    pub fn score(&self, query: &str) -> Vec<f32> {
        let query_tokens = tokenize(query);
        let k1 = 1.5f32;
        let b = 0.75f32;
        let mut scores = vec![0.0f32; self.doc_count];

        for token in query_tokens {
            let df = match self.term_doc_freqs.get(&token) {
                Some(&cnt) => cnt as f32,
                None => continue,
            };

            // IDF calculation with smoothing
            let idf = ((self.doc_count as f32 - df + 0.5) / (df + 0.5) + 1.0).ln();

            for (idx, tf_map) in self.doc_term_freqs.iter().enumerate() {
                if let Some(&tf) = tf_map.get(&token) {
                    let tf = tf as f32;
                    let doc_len = self.doc_lens[idx] as f32;
                    let num = tf * (k1 + 1.0);
                    let den = tf + k1 * (1.0 - b + b * (doc_len / (self.avg_doc_len + 1e-5)));
                    scores[idx] += idf * (num / den);
                }
            }
        }

        scores
    }
}
