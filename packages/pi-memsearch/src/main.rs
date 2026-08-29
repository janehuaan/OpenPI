//! pi-memsearch v0.1 — hybrid vector + BM25 search engine for benchmarking.
//!
//! Usage: echo '<json>' | target/release/pi-memsearch --limit 50 --alpha 0.55
//! Input JSON: {"docs":[{"id","type","key","value","body"}], "query": "..."}
//! Output JSON: {"elapsed_ms": N, "hit_count": N, "hits": [...]}

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::{self, Read};
use std::sync::OnceLock;
use std::time::Instant;

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

/// QUERY_EXPAND from rank.ts — flat list of (term, synonyms...) tuples.
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
struct Hit { id: String, score: f64, vector_score: f64, bm25_score: f64 }
fn default_alpha() -> f64 { 0.55 }

// ── FNV-1a ───────────────────────────────────────────────────────────────────
fn fnv1a_bytes(b: &[u8]) -> u32 {
    let mut h: u32 = 0x811c9dc5;
    for &byte in b { h ^= byte as u32; h = h.wrapping_mul(0x01000193); }
    h
}
// Match TS: fnv1a iterates over UTF-16 code units, XOR'ing each unit's value.
// We implement it over bytes of the UTF-16LE encoding.
fn fnv1a_utf16(s: &str) -> u32 {
    let mut buf: Vec<u8> = Vec::new();
    for u in s.encode_utf16() { buf.extend_from_slice(&u.to_le_bytes()); }
    fnv1a_bytes(&buf)
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
        let mixed = chars.iter().any(|c| re_cjk().is_match(&c.to_string()))
            && chars.iter().any(|c| !re_cjk().is_match(&c.to_string()));
        if chars.iter().all(|c| re_cjk().is_match(&c.to_string())) {
            // Pure CJK
            let mut LatinBuf = String::new();
            let flush_lat = |buf: &str, out: &mut Vec<String>, seen: &mut HashSet<String>| {
                if buf.len() > 1 && !STOP.contains(&buf) && seen.insert(buf.to_string()) {
                    out.push(buf.to_string());
                }
            };
            for ch in &chars {
                if re_cjk().is_match(&ch.to_string()) {
                    flush_lat(&LatinBuf, &mut out, &mut seen);
                    LatinBuf.clear();
                    let s = ch.to_string();
                    if seen.insert(s.clone()) { out.push(s); }
                } else if ch.is_alphanumeric() {
                    LatinBuf.push(*ch);
                } else {
                    flush_lat(&LatinBuf, &mut out, &mut seen);
                    LatinBuf.clear();
                }
            }
            flush_lat(&LatinBuf, &mut out, &mut seen);
            for i in 0..chars.len().saturating_sub(1) {
                let bigram = format!("{}{}", chars[i], chars[i+1]);
                if seen.insert(bigram.clone()) { out.push(bigram); }
            }
            if chars.len() >= 6 {
                for i in 0..chars.len().saturating_sub(2) {
                    let trigram = format!("{}{}{}", chars[i], chars[i+1], chars[i+2]);
                    if seen.insert(trigram.clone()) { out.push(trigram); }
                }
            }
        } else if mixed {
            // Mixed: flush latin runs, push CJK chars, then bigrams/trigrams for CJK runs
            let mut LatinBuf = String::new();
            let flush_lat = |buf: &str, out: &mut Vec<String>, seen: &mut HashSet<String>| {
                if buf.len() > 1 && !STOP.contains(&buf) && seen.insert(buf.to_string()) {
                    out.push(buf.to_string());
                }
            };
            let mut cjk_run: Vec<char> = Vec::new();
            let flush_cjk_run = |run: &[char], out: &mut Vec<String>, seen: &mut HashSet<String>| {
                for &ch in run {
                    let s = ch.to_string();
                    if seen.insert(s.clone()) { out.push(s); }
                }
                for i in 0..run.len().saturating_sub(1) {
                    let bg = format!("{}{}", run[i], run[i+1]);
                    if seen.insert(bg.clone()) { out.push(bg); }
                }
                if run.len() >= 6 {
                    for i in 0..run.len().saturating_sub(2) {
                        let tg = format!("{}{}{}", run[i], run[i+1], run[i+2]);
                        if seen.insert(tg.clone()) { out.push(tg); }
                    }
                }
            };
            for ch in &chars {
                if re_cjk().is_match(&ch.to_string()) {
                    flush_lat(&LatinBuf, &mut out, &mut seen);
                    LatinBuf.clear();
                    cjk_run.push(*ch);
                } else if ch.is_alphanumeric() {
                    flush_cjk_run(&cjk_run, &mut out, &mut seen);
                    cjk_run.clear();
                    LatinBuf.push(*ch);
                } else {
                    flush_lat(&LatinBuf, &mut out, &mut seen);
                    LatinBuf.clear();
                    flush_cjk_run(&cjk_run, &mut out, &mut seen);
                    cjk_run.clear();
                }
            }
            flush_lat(&LatinBuf, &mut out, &mut seen);
            flush_cjk_run(&cjk_run, &mut out, &mut seen);
        } else {
            // Pure Latin
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
            for s in syns.iter() {
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
            for s in syns.iter() {
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
    // Word features: "w:{word}" where word len (UTF-16) > 1
    for t in re_word_sep().split(&norm).filter(|t| !t.is_empty()) {
        let u16_len = t.encode_utf16().count();
        if u16_len > 1 {
            let mut buf = Vec::new();
            buf.extend_from_slice(b"w:");
            t.encode_utf16().for_each(|u| buf.extend_from_slice(&u.to_le_bytes()));
            feat_bufs.push(buf);
        }
    }
    // CJK unigrams + n-grams from compacted string (UTF-16 units)
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

// ── Hybrid search ────────────────────────────────────────────────────────────
fn hybrid_search(input: &QueryInput) -> Vec<Hit> {
    let alpha = input.alpha;
    let limit = input.limit.unwrap_or(50);
    let docs: Vec<(String, String)> = input.docs.iter().map(|d| {
        (d.id.clone(), d.text.clone().unwrap_or_else(|| doc_text(d)))
    }).collect();
    if docs.is_empty() || input.query.trim().is_empty() { return vec![]; }
    let N = docs.len();
    let q_emb = embed_text(&input.query);
    let corpus = build_corpus(&docs.iter().map(|(_, text)| text.clone()).collect::<Vec<_>>());
    let bm25_results = rank_bm25(&input.query, &corpus);
    let max_bm25 = bm25_results.first().map(|(_,s)| *s).unwrap_or(1.0);

    let mut cand_ids: Vec<String> = Vec::new();
    let mut cand_set: HashSet<String> = HashSet::new();
    for (idx, _) in &bm25_results {
        let id = docs[*idx].0.clone();
        if cand_set.insert(id.clone()) { cand_ids.push(id); }
    }
    let mut vscores: HashMap<String, f64> = HashMap::new();
    let top_k = if N <= 10_000 { N } else { 3_000 };
    let mut scored: Vec<(String, f64)> = Vec::new();
    for id in &cand_ids {
        if let Some(text) = docs.iter().find(|(i,_)| i==id).map(|(_,t)| t.as_str()) {
            let emb = embed_text(text);
            let s: f64 = q_emb.iter().zip(emb.iter()).map(|(a,b)| (*a as f64)*(*b as f64)).sum();
            if s > 0.04 { scored.push((id.clone(), s)); vscores.insert(id.clone(), s); }
        }
    }
    scored.sort_by(|a,b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    for (id,s) in scored.iter().take(top_k) {
        if cand_set.insert(id.clone()) { cand_ids.push(id.clone()); }
        vscores.insert(id.clone(), *s);
    }
    for id in &cand_ids {
        if vscores.contains_key(id) { continue; }
        if let Some(text) = docs.iter().find(|(i,_)| i==id).map(|(_,t)| t.as_str()) {
            let emb = embed_text(text);
            let s: f64 = q_emb.iter().zip(emb.iter()).map(|(a,b)| (*a as f64)*(*b as f64)).sum();
            vscores.insert(id.clone(), s);
        }
    }
    if cand_ids.is_empty() {
        let qt = tokenize(&expand_query(&input.query));
        for (id,text) in &docs {
            let low = text.to_lowercase();
            if qt.iter().any(|t| low.contains(t.as_str())) {
                if cand_set.insert(id.clone()) { cand_ids.push(id.clone()); }
            }
        }
        if cand_ids.is_empty() && !docs.is_empty() {
            for (id,_) in docs.iter().take(std::cmp::min(N, 2000)) {
                if cand_set.insert(id.clone()) { cand_ids.push(id.clone()); }
            }
        }
    }
    if N <= 2000 {
        for (id,_) in &docs { if cand_set.insert(id.clone()) { cand_ids.push(id.clone()); } }
    }
    let mut hits: Vec<Hit> = Vec::new();
    for id in &cand_ids {
        let bm_raw = bm25_results.iter().find(|(idx,_)| docs[*idx].0==*id).map(|(_,s)|*s).unwrap_or(0.0);
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

fn main() {
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
    let mut input: QueryInput = match serde_json::from_str(&stdin_data) {
        Ok(v) => v,
        Err(e) => { eprintln!("JSON error: {}", e); std::process::exit(2); }
    };
    if let Some(l) = limit { input.limit = Some(l); }
    if let Some(a) = alpha { input.alpha = a; }
    let t0 = Instant::now();
    let hits = hybrid_search(&input);
    let ms = t0.elapsed().as_secs_f64() * 1000.0;
    println!("{}", serde_json::json!({"elapsed_ms": ms, "hit_count": hits.len(), "hits": hits}));
}
