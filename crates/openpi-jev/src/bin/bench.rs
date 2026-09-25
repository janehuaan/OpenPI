use std::path::PathBuf;
use std::time::Instant;
use ort::session::Session;
use ort::value::Tensor;
use tokenizers::Tokenizer;

fn get_home_dir() -> PathBuf {
    std::env::var("HOME").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("."))
}

fn benchmark_model(name: &str, model_path: &PathBuf, tokenizer: &Tokenizer, prompt: &str, runs: usize) -> anyhow::Result<()> {
    println!("\n========================================================");
    println!("🚀 正在测试原生 Rust 推理: {}", name);
    println!("📁 模型路径: {:?}", model_path);

    if !model_path.exists() {
        println!("❌ 模型文件不存在: {:?}", model_path);
        return Ok(());
    }

    let load_start = Instant::now();
    let mut session = Session::builder()
        .map_err(|e| anyhow::anyhow!("{:?}", e))?
        .with_intra_threads(4)
        .map_err(|e| anyhow::anyhow!("{:?}", e))?
        .commit_from_file(model_path)
        .map_err(|e| anyhow::anyhow!("{:?}", e))?;
    let load_time = load_start.elapsed();
    println!("⚡ 模型加载与图编译耗时: {:?}", load_time);

    let encoding = tokenizer.encode(prompt, true).map_err(|e| anyhow::anyhow!("{:?}", e))?;
    let input_ids: Vec<i64> = encoding.get_ids().iter().map(|&id| id as i64).collect();
    let seq_len = input_ids.len();
    let attention_mask: Vec<i64> = vec![1i64; seq_len];
    println!("📝 测试 Prompt: \"{}\"", prompt);
    println!("🔢 Token 数量: {}", seq_len);

    let batch_size = 1usize;
    let input_ids_tensor = Tensor::from_array(([batch_size, seq_len], input_ids))
        .map_err(|e| anyhow::anyhow!("{:?}", e))?;
    let attention_mask_tensor = Tensor::from_array(([batch_size, seq_len], attention_mask))
        .map_err(|e| anyhow::anyhow!("{:?}", e))?;

    // Warmup
    print!("🔥 预热中 (Warmup 3 次)... ");
    for _ in 0..3 {
        let _ = session.run(ort::inputs![
            "input_ids" => &input_ids_tensor,
            "attention_mask" => &attention_mask_tensor
        ])
        .map_err(|e| anyhow::anyhow!("{:?}", e))?;
    }
    println!("完成！");

    // Benchmark
    println!("⏱️  正式压测 (运行 {} 次并统计延时)...", runs);
    let mut latencies: Vec<f64> = Vec::with_capacity(runs);

    for _ in 0..runs {
        let start = Instant::now();
        let _ = session.run(ort::inputs![
            "input_ids" => &input_ids_tensor,
            "attention_mask" => &attention_mask_tensor
        ])
        .map_err(|e| anyhow::anyhow!("{:?}", e))?;
        latencies.push(start.elapsed().as_secs_f64() * 1000.0);
    }

    latencies.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let avg = latencies.iter().sum::<f64>() / (latencies.len() as f64);
    let p50 = latencies[latencies.len() / 2];
    let p95 = latencies[(latencies.len() as f64 * 0.95) as usize];
    let min = latencies[0];
    let max = latencies[latencies.len() - 1];

    println!("📊 压测结果统计 (Intel Core i7-9750H, 4 线程 AVX2):");
    println!("   - 平均延时 (Avg):   {:.2} ms", avg);
    println!("   - 中位数 (P50):     {:.2} ms", p50);
    println!("   - 95分位 (P95):     {:.2} ms", p95);
    println!("   - 最快 (Min):       {:.2} ms", min);
    println!("   - 最慢 (Max):       {:.2} ms", max);
    println!("========================================================");

    Ok(())
}

fn main() -> anyhow::Result<()> {
    let dylib_path = get_home_dir().join(".openpi/lib/onnxruntime-osx-x86_64-1.20.1/lib/libonnxruntime.dylib");
    if dylib_path.exists() {
        let _ = ort::init_from(dylib_path.to_str().unwrap())
            .map_err(|e| anyhow::anyhow!("{:?}", e))?
            .commit();
    } else {
        let _ = ort::init().commit();
    }

    let model_dir = get_home_dir().join(".openpi/models/verdict");
    let tokenizer_path = model_dir.join("tokenizer.json");
    let fp32_path = model_dir.join("model.onnx");
    let int8_path = model_dir.join("model_int8.onnx");

    println!("🎯 读取分词器: {:?}", tokenizer_path);
    let tokenizer = Tokenizer::from_file(&tokenizer_path).map_err(|e| anyhow::anyhow!("{:?}", e))?;

    // 典型的命令行安全审查 Prompt
    let prompt = "Context: The user asked to remove unnecessary build artifacts. Action: rm -rf ./target/release && cargo clean";

    if int8_path.exists() {
        benchmark_model("ModernBERT-base (INT8 量化优化版)", &int8_path, &tokenizer, prompt, 30)?;
    }

    if fp32_path.exists() {
        benchmark_model("ModernBERT-base (FP32 全精度版)", &fp32_path, &tokenizer, prompt, 20)?;
    }

    Ok(())
}
