//! 记忆自适应衰减与冷热分层模型 (Adaptive Memory Decay & Tiering)
//!
//! 依据艾宾浩斯记忆遗忘模型 (Ebbinghaus Forgetting Curve):
//!   R = exp( - delta_t / (S * tau) )
//! 其中 S 为访问强度增强因子 (随着复用次数递增)，tau 为基础半衰期。
//! 严格遵循 MDL (极简代码律) 与 零垃圾回收微开销设计。

use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MemoryAccessRecord {
    pub key: String,
    pub access_count: u32,
    pub created_at: u64,
    pub last_accessed_at: u64,
    pub base_weight: f32,
}

impl MemoryAccessRecord {
    pub fn new(key: impl Into<String>, base_weight: f32) -> Self {
        let now = now_epoch_secs();
        Self {
            key: key.into(),
            access_count: 1,
            created_at: now,
            last_accessed_at: now,
            base_weight,
        }
    }

    /// 记录一次访问（自适应强化访问频次与时间戳）
    pub fn touch(&mut self) {
        self.access_count = self.access_count.saturating_add(1);
        self.last_accessed_at = now_epoch_secs();
    }

    /// 计算当前有效衰减权重（半衰期单位：秒，默认 24 小时 = 86400s）
    pub fn compute_retention(&self, half_life_secs: f32) -> f32 {
        let now = now_epoch_secs();
        let delta_t = (now.saturating_sub(self.last_accessed_at)) as f32;
        
        // 强度强化因子 S：每被重复访问一次，记忆抗衰减强度提升 25% (上限 4.0x)
        let strength = (1.0 + (self.access_count as f32 - 1.0) * 0.25).min(4.0);
        let tau = half_life_secs * strength;

        let decay = (-delta_t / tau.max(1.0)).exp();
        (self.base_weight * decay).clamp(0.0, 1.0)
    }

    /// 判定是否应降级进入冷存储归档 (冷存储门限通常 < 0.1)
    pub fn is_cold(&self, half_life_secs: f32, cold_threshold: f32) -> bool {
        self.compute_retention(half_life_secs) < cold_threshold
    }
}

fn now_epoch_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::from_secs(0))
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_retention_fresh() {
        let rec = MemoryAccessRecord::new("skill:tauri", 1.0);
        let retention = rec.compute_retention(3600.0);
        assert!(retention > 0.99, "刚创建的记忆保留度应接近 1.0");
    }

    #[test]
    fn test_access_reinforcement() {
        let mut rec = MemoryAccessRecord::new("skill:security", 1.0);
        rec.last_accessed_at = now_epoch_secs() - 7200; // 模拟 2 小时前

        let r1 = rec.compute_retention(3600.0);
        
        // 模拟多次重复 touch 强化记忆
        rec.touch();
        rec.last_accessed_at = now_epoch_secs() - 7200; // 同样放置 2 小时
        let r2 = rec.compute_retention(3600.0);

        assert!(r2 > r1, "多次访问强化的记忆在相同时间后的衰减残留度应更高");
    }
}
