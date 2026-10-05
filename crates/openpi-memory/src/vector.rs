use crate::metal::HardwareInspector;

pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }

    HardwareInspector::cosine_similarity(a, b)
}
