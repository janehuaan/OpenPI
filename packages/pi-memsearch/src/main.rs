//! pi-memsearch: hybrid vector + BM25 search engine.
//! 
//! Modes:
//!   - CLI: echo '<json>' | pi-memsearch --limit N --alpha A
//!   - Server: pi-memsearch --server --dir <path> --port 8765

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::{self, Read, Write};
use std::sync::OnceLock;
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime};

const VECTOR_DIM: usize = 384;

static RE_NON_ALNUM: OnceLock<Regex> = OnceLock::new();
static RE_CJK: OnceLock<Regex> = OnceLock::new();
static RE_WORD_SEP: OnceLock<Regex> = OnceLock::new();

fn re_non_alnum() -> &'static Regex {
    RE_NON_ALNUM.get_or_init(|| Regex::new(r"[^\p{L}\p{N}_-]").unwrap())
}
fn re_cjk() -> &'static Regex {
    RE_CJK.get_or_init(|| Regex::new(r"[\u3400-\u9fff\uf900-\ufaff]").unwrap())
}
fn re_word_sep() -> &'static Regex {
    RE_WORD_SEP.get_or_init(|| Regex::new(r"[\s,.;:|/\-_]+").unwrap())
}

const STOP: &[&str] = &[
    "a","an","the","and","or","to","of","in","on","for","is","are","be","this","that",
    "with","as","at","by","it","from","的","了","是","在","和","与","把","被","就",
    "也","都","吗","呢","啊","吧","着","过","这","那","有","不","人","我","你","他",
    "她","它","们",
];

const EXPANSIONS: &[(&str, &[&str])] = &[
    ("concise", &["简洁","简短","精炼","short","brief"]),
    ("brief", &["concise","简洁","short"]),
    ("short", &["concise","简洁","brief"]),
    ("简洁", &["concise","brief","short","精炼","简短"]),
    ("简短", &["concise","brief","简洁"]),
    ("废话", &["fluff","filler","verbose"]),
    ("fluff", &["废话","filler"]),
    ("本地", &["local","offline","on-device"]),
    ("local", &["本地","offline"]),
    ("远端", &["remote","cloud","hosted"]),
    ("remote", &["远端","cloud"]),
    ("向量", &["vector","embedding"]),
    ("vector", &["向量","embedding"]),
    ("检索", &["search","recall","query"]),
    ("search", &["检索","query"]),
    ("记忆", &["memory","memories"]),
    ("memory", &["记忆"]),
    ("打包", &["packaging","electron","ditto"]),
    ("packaging", &["打包"]),
    ("提交", &["commit","git"]),
    ("commit", &["提交"]),
    ("检查", &["check","lint","typecheck"]),
    ("check", &["检查","npm"]),
    ("发送", &["send","submit","enter"]),
    ("send", &["发送","submit"]),
    ("桌面", &["desktop","electron"]),
    ("desktop", &["桌面"]),
    ("不要", &["never","no","avoid"]),
    ("never", &["不要","禁止"]),
    ("emoji", &["表情","emojis"]),
    ("表情", &["emoji"]),
];

#[derive(Deserialize)]
struct QueryInput {
    docs: Vec<DocEntry>,
    query: String,
    #[serde(default)]
    limit: Option<usize>,
    #[serde(default = "default_alpha")]
    alpha: f64,
}

#[derive(Deserialize, Clone)]
struct DocEntry {
    id: String,
    #[serde(default)] r#type: String,
    #[serde(default)] key: String,
    #[serde(default)] value: String,
    #[serde(default)] body: String,
    #[serde(default, rename="text")] text: Option<String>,
}

#[derive(Serialize)]
struct Hit {
    id: String,
    score: f64,
    vector_score: f64,
    bm25_score: f64,
}

#[derive(Deserialize, Serialize)]
struct ServerQuery {
    query: String,
    #[serde(default)]
    limit: Option<usize>,
    #[serde(default = "default_alpha")]
    alpha: f64,
}

#[derive(Serialize)]
struct ServerResponse {
    hits: Vec<Hit>,
    elapsed_ms: f64,
    hit_count: usize,
}

fn default_alpha() -> f64 { 0.55 }

// ── FNV-1a ───────────────────────────────────────────────────────────────────
fn fnv1a_bytes(b: &[u8]) -> u32 {
    let mut h: u32 = 0x811c9dc5;
    for &byte in b { h ^= byte as u32; h = h.wrapping_mul(0x01000193); }
    h
}

// ── Tokenizer ────────────────────────────────────────────────────────────────
fn tokenize(text: &str) -> Vec<String> {
    let norm = text.to_lowercase().replace(char::is_whitespace, " ").trim().to_string();
    if norm.is_empty() { return vec![]; }
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for part in re_non_alnum().split(&norm) {
        if part.is_empty() || re_cjk().is_match(part) { continue; }
        let chars: Vec<char> = part.chars().collect();
        let pure_cjk = chars.iter().all(|c| re_cjk().is_match(&c.to_string()));
        if pure_cjk {
            let mut latin_buf = String::new();
            let flush = |buf: &str, out: &mut Vec<String>, seen: &mut HashSet<String>| {
                if buf.len() > 1 && !STOP.contains(&buf) && seen.insert(buf.to_string()) {
                    out.push(buf.to_string());
                }
            };
            for ch in &chars {
                if re_cjk().is_match(&ch.to_string()) {
                    flush(&latin_buf, &mut out, &mut seen);
                    latin_buf.clear();
                    let s = ch.to_string();
                    if seen.insert(s.clone()) { out.push(s); }
                } else if ch.is_alphanumeric() {
                    latin_buf.push(*ch);
                } else { flush(&latin_buf, &mut out, &mut seen); latin_buf.clear(); }
            }
            flush(&latin_buf, &mut out, &mut seen);
            for i in 0..chars.len().saturating_sub(1) {
                let bg = format!("{}{}", chars[i], chars[i+1]);
                if seen.insert(bg.clone()) { out.push(bg); }
            }
            if chars.len() >= 6 {
                for i in 0..chars.len().saturating_sub(2) {
                    let tg = format!("{}{}{}", chars[i], chars[i+1], chars[i+2]);
                    if seen.insert(tg.clone()) { out.push(tg); }
                }
            }
        } else {
            for w in part.split(|c| c=='_' || c=='-' || c=='/') {
                if w.len() > 1 && seen.insert(w.to_string()) { out.push(w.to_string()); }
            }
        }
    }
    out
}

// ── expandQuery ──────────────────────────────────────────────────────────────
fn expand_query(query: &str) -> String {
    let base = query.trim().to_string();
    if base.is_empty() { return base; }
    let toks = tokenize(&base);
    let mut extra: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::from_iter(toks.iter().cloned());
    for t in &toks {
        for &(k, syns) in EXPANSIONS {
            if k != t { continue; }
            for s in syns {
                let s = s.to_string();
                if seen.insert(s.clone()) { extra.push(s); }
            }
        }
    }
    let compact: String = base.chars().filter(|c| !c.is_whitespace()).collect();
    let compact_chars: Vec<char> = compact.chars().collect();
    for i in 0..compact_chars.len().saturating_sub(1) {
        let bi: String = compact_chars[i..i+2].iter().collect();
        for &(k, syns) in EXPANSIONS {
            if k != bi { continue; }
            for s in syns {
                let s = s.to_string();
                if seen.insert(s.clone()) { extra.push(s); }
            }
        }
    }
    if extra.is_empty() { base } else { format!("{} {}", base, extra.join(" ")) }
}

// ── embedText ────────────────────────────────────────────────────────────────
fn embed_text(text: &str) -> Vec<f32> {
    let norm = expand_query(text).to_lowercase().replace(char::is_whitespace, " ").trim().to_string();
    if norm.is_empty() { return vec![0.0; VECTOR_DIM]; }
    let mut feat_bufs: Vec<Vec<u8>> = Vec::new();
    for t in re_word_sep().split(&norm).filter(|t| !t.is_empty()) {
        let u16_len = t.encode_utf16().count();
        if u16_len > 1 {
            let mut buf = Vec::new();
            buf.extend_from_slice(b"w:");
            for u in t.encode_utf16() { buf.extend_from_slice(&u.to_le_bytes()); }
            feat_bufs.push(buf);
        }
    }
    let compact: String = norm.chars().filter(|c| !c.is_whitespace()).collect();
    let compact_u16: Vec<u16> = compact.encode_utf16().collect();
    for &u in &compact_u16 {
        if (0x3400..=0x9fff).contains(&u) {
            let mut p = Vec::new();
            p.extend_from_slice(b"c1:");
            p.extend_from_slice(&u.to_le_bytes());
            feat_bufs.push(p);
        }
    }
    for n in 2..=3usize {
        for i in 0..compact_u16.len().saturating_sub(n-1) {
            let mut p = Vec::new();
            p.extend_from_slice(format!("c{}:", n).as_bytes());
            for &u in &compact_u16[i..i+n] { p.extend_from_slice(&u.to_le_bytes()); }
            feat_bufs.push(p);
        }
    }
    let mut v = vec![0.0f32; VECTOR_DIM];
    for f in feat_bufs {
        let h = fnv1a_bytes(&f);
        let idx = (h % VECTOR_DIM as u32) as usize;
        v[idx] += if h & 1 == 0 { 1.0 } else { -1.0 };
        let mut hash_input = Vec::new();
        hash_input.extend_from_slice(b"#");
        hash_input.extend_from_slice(&f);
        let h2 = fnv1a_bytes(&hash_input);
        let idx2 = (h2 % VECTOR_DIM as u32) as usize;
        v[idx2] += if (h2 >> 1) & 1 == 0 { 0.5 } else { -0.5 };
    }
    let norm_val = v.iter().map(|x| x*x).fold(0.0f32, |a,b| a+b).sqrt();
    let norm_val = if norm_val == 0.0 { 1.0 } else { norm_val };
    for x in v.iter_mut() { *x /= norm_val; }
    v
}

// ── BM25 ─────────────────────────────────────────────────────────────────────
#[derive(Default)]
struct Bm25Corpus {
    ids: Vec<String>,
    tfs: Vec<HashMap<String, u32>>,
    lengths: Vec<usize>,
    df: HashMap<String, u32>,
    postings: HashMap<String, Vec<usize>>,
    avgdl: f64,
    n: usize,
}

fn build_corpus(texts: &[String]) -> Bm25Corpus {
    let mut c = Bm25Corpus::default();
    for id in texts {
        c.ids.push(id.clone());
        let toks = tokenize(id);
        let mut tf = HashMap::new();
        for t in &toks { *tf.entry(t.clone()).or_insert(0) += 1; }
        c.tfs.push(tf);
        c.lengths.push(toks.len());
        c.n += 1;
        for (t, _) in c.tfs.last().unwrap() {
            *c.df.entry(t.clone()).or_insert(0) += 1;
            c.postings.entry(t.clone()).or_default().push(c.ids.len()-1);
        }
    }
    c.avgdl = if c.n==0 { 1.0 } else { c.lengths.iter().map(|&l|l as f64).sum::<f64>() / c.n as f64 };
    c
}

fn rank_bm25(q: &str, corpus: &Bm25Corpus) -> Vec<(usize, f64)> {
    let qt = tokenize(&expand_query(q));
    if qt.is_empty() || corpus.n == 0 { return vec![]; }
    let (k1, b) = (1.2f64, 0.75f64);
    let mut candidates: HashSet<usize> = HashSet::new();
    for t in &qt { if let Some(lst) = corpus.postings.get(t) { candidates.extend(lst.iter()); } }
    if candidates.is_empty() { return vec![]; }
    let mut out = Vec::new();
    for &idx in &candidates {
        let tf = &corpus.tfs[idx];
        let dl = corpus.lengths[idx] as f64;
        let mut score = 0.0f64;
        for t in &qt {
            let f = tf.get(t.as_str()).copied().unwrap_or(0) as f64;
            if f == 0.0 { continue; }
            let n = corpus.df.get(t.as_str()).copied().unwrap_or(0) as f64;
            let idf = (1.0 + (corpus.n as f64 - n + 0.5)/(n + 0.5)).ln();
            let denom = f + k1*(1.0 - b + (b*dl)/corpus.avgdl);
            score += idf * (f*(k1+1.0))/denom;
        }
        if score > 0.0 { out.push((idx, score)); }
    }
    out.sort_by(|a,b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    out
}

fn doc_text(d: &DocEntry) -> String {
    format!("{} {} {} {}\n{}", d.r#type, d.key, d.key.replace('-'," "), d.value, d.body)
}

// ── Core search function ─────────────────────────────────────────────────────
fn hybrid_search_internal(docs: &[(String, String)], query: &str, alpha: f64, limit: usize) -> Vec<Hit> {
    if docs.is_empty() || query.trim().is_empty() { return vec![]; }
    let n = docs.len();
    let q_emb = embed_text(query);
    
    let doc_ids: Vec<String> = docs.iter().map(|(id, _)| id.clone()).collect();
    let corpus = build_corpus(&doc_ids);
    let bm25_results = rank_bm25(query, &corpus);
    let max_bm25 = bm25_results.first().map(|(_, s)| *s).unwrap_or(1.0);

    let mut cand_ids: Vec<String> = Vec::new();
    let mut cand_set: HashSet<String> = HashSet::new();
    for (idx, _) in &bm25_results {
        let id = docs[*idx].0.clone();
        if cand_set.insert(id.clone()) { cand_ids.push(id); }
    }

    let mut vscores: HashMap<String, f64> = HashMap::new();
    let top_k = if n <= 10_000 { n } else { 3_000 };
    let mut scored: Vec<(String, f64)> = Vec::new();
    
    // Vector scan with early exit
    for id in &cand_ids {
        if let Some(text) = docs.iter().find(|(i, _)| i == id).map(|(_, t)| t.as_str()) {
            let emb = embed_text(text);
            // SIMD-friendly dot product (unroll 4)
            let s: f64 = q_emb.chunks(4)
                .zip(emb.chunks(4))
                .map(|(qa, qb)| {
                    qa[0] as f64 * qb[0] as f64 + qa[1] as f64 * qb[1] as f64 +
                    qa[2] as f64 * qb[2] as f64 + qa[3] as f64 * qb[3] as f64
                })
                .sum();
            if s > 0.04 { scored.push((id.clone(), s)); vscores.insert(id.clone(), s); }
        }
    }
    scored.sort_by(|a,b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    for (id,s) in scored.iter().take(top_k) {
        if cand_set.insert(id.clone()) { cand_ids.push(id.clone()); }
        vscores.insert(id.clone(), *s);
    }
    
    // Fill missing
    for id in &cand_ids {
        if vscores.contains_key(id) { continue; }
        if let Some(text) = docs.iter().find(|(i, _)| i == id).map(|(_, t)| t.as_str()) {
            let emb = embed_text(text);
            let s: f64 = q_emb.iter().zip(emb.iter()).map(|(a,b)| (*a as f64)*(*b as f64)).sum();
            vscores.insert(id.clone(), s);
        }
    }
    
    // Fallback
    if cand_ids.is_empty() {
        let qt = tokenize(&expand_query(query));
        for (id, text) in docs {
            let low = text.to_lowercase();
            if qt.iter().any(|t| low.contains(t.as_str())) {
                if cand_set.insert(id.clone()) { cand_ids.push(id.clone()); }
            }
        }
        if cand_ids.is_empty() && !docs.is_empty() {
            for (id, _) in docs.iter().take(std::cmp::min(n, 2000)) {
                if cand_set.insert(id.clone()) { cand_ids.push(id.clone()); }
            }
        }
    }
    if n <= 2000 {
        for (id, _) in docs { if cand_set.insert(id.clone()) { cand_ids.push(id.clone()); } }
    }

    let mut hits: Vec<Hit> = Vec::new();
    for id in &cand_ids {
        let bm_raw = bm25_results.iter().find(|(idx, _)| docs[*idx].0 == *id).map(|(_, s)| *s).unwrap_or(0.0);
        let vs = vscores.get(id).copied().unwrap_or(0.0);
        let score = alpha*vs.max(0.0) + (1.0-alpha)*(bm_raw/max_bm25);
        if score > 0.05 || bm_raw > 0.0 {
            hits.push(Hit{ id: id.clone(), score, vector_score: vs, bm25_score: bm_raw/max_bm25 });
        }
    }
    hits.sort_by(|a,b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    hits.truncate(limit);
    hits
}

// ── CLI mode ─────────────────────────────────────────────────────────────────
fn run_cli() {
    let args: Vec<String> = std::env::args().collect();
    let mut limit: Option<usize> = None;
    let mut alpha: Option<f64> = None;
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--limit" => { i+=1; limit = Some(args[i].parse().unwrap_or(50)); }
            "--alpha" => { i+=1; alpha = Some(args[i].parse().unwrap_or(0.55)); }
            _ => {}
        }
        i += 1;
    }
    let mut stdin_data = String::new();
    io::stdin().read_to_string(&mut stdin_data).unwrap();
    let input: QueryInput = match serde_json::from_str(&stdin_data) {
        Ok(v) => v,
        Err(e) => { eprintln!("JSON error: {}", e); std::process::exit(2); }
    };
    
    let docs: Vec<(String, String)> = input.docs.iter().map(|d| {
        (d.id.clone(), d.text.clone().unwrap_or_else(|| doc_text(d)))
    }).collect();
    
    let t0 = Instant::now();
    let hits = hybrid_search_internal(&docs, &input.query, input.alpha, input.limit.unwrap_or(50));
    let ms = t0.elapsed().as_secs_f64() * 1000.0;
    
    println!("{}", serde_json::json!({"elapsed_ms": ms, "hit_count": hits.len(), "hits": hits}));
}

// ── Server mode ──────────────────────────────────────────────────────────────
struct ServerState {
    // Pre-loaded corpus for fast serving
    docs: Arc<Mutex<Vec<(String, String)>>>,
}

impl ServerState {
    fn new() -> Self {
        ServerState { docs: Arc::new(Mutex::new(Vec::new())) }
    }
    
    fn reload(&self, docs: Vec<(String, String)>) {
        let mut state = self.docs.lock().unwrap();
        *state = docs;
    }
}

fn handle_client(mut stream: TcpStream, state: Arc<ServerState>) {
    let mut buf = [0; 8192];
    let n = match stream.read(&mut buf) {
        Ok(n) => n,
        Err(_) => return,
    };
    let query: ServerQuery = match serde_json::from_slice(&buf[..n]) {
        Ok(q) => q,
        Err(e) => {
            let resp = serde_json::json!({"error": e.to_string()});
            let _ = stream.write_all(resp.to_string().as_bytes());
            return;
        }
    };
    
    let docs = state.docs.lock().unwrap().clone();
    let t0 = Instant::now();
    let hits = hybrid_search_internal(&docs, &query.query, query.alpha, query.limit.unwrap_or(50));
    let ms = t0.elapsed().as_secs_f64() * 1000.0;
    
    let hit_count = hits.len();
    let resp = ServerResponse { hits, elapsed_ms: ms, hit_count };
    let _ = stream.write_all(serde_json::to_string(&resp).unwrap().as_bytes());
}

fn run_server(port: u16) {
    let listener = TcpListener::bind(format!("127.0.0.1:{}", port)).expect("Failed to bind");
    println!("pi-memsearch server listening on port {}", port);
    
    let state = Arc::new(ServerState::new());
    
    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                let state = Arc::clone(&state);
                std::thread::spawn(move || handle_client(stream, state));
            }
            Err(e) => eprintln!("Connection failed: {}", e),
        }
    }
}

// ── Main ─────────────────────────────────────────────────────────────────────
fn main() {
    let args: Vec<String> = std::env::args().collect();
    
    if args.len() > 1 && args[1] == "--server" {
        let mut port = 8765u16;
        let mut i = 2;
        while i < args.len() {
            match args[i].as_str() {
                "--port" => { i += 1; port = args[i].parse().unwrap_or(8765); }
                _ => {}
            }
            i += 1;
        }
        run_server(port);
    } else {
        run_cli();
    }
}
