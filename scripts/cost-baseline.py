#!/usr/bin/env python3
"""End-to-end cost baseline for OpenPI agent turns.

A green test suite only proves correctness; it says nothing about how many tokens
or LLM round-trips a turn costs. That is how a system can pass every test while
getting slower. This measures the cost side from the session journals (each
assistant message records its token usage), so a change can be judged on cost,
not just on correctness.

Per session:
  turns     user messages
  calls     assistant LLM calls (one turn is usually many)
  tools     tool calls
  in_sum    total input tokens billed
  in_med    median input tokens per call (how fat the per-call context is)
  in_max    largest single input
  first_in  input tokens of the session's first call = fixed overhead (system
            prompt + tool definitions), independent of the task
  out_sum   total output tokens
  span_s    wall clock from first to last journal entry

Usage:
  python3 scripts/cost-baseline.py                    # recent sessions
  python3 scripts/cost-baseline.py --limit 20
  python3 scripts/cost-baseline.py --save .cost-baseline.json
  python3 scripts/cost-baseline.py --compare .cost-baseline.json
  python3 scripts/cost-baseline.py --json
"""

import argparse
import datetime as dt
import glob
import json
import os
import socket
import statistics
import sys
import time

SKIP_PREFIXES = ("task-ses", "nope", "subagent")


def sessions_dir():
    base = os.environ.get("OPENPI_DIR") or os.path.join(os.path.expanduser("~"), ".openpi")
    return os.path.join(base, "sessions")


def socket_path():
    env = os.environ.get("OPENPI_SOCKET_PATH")
    if env:
        return env
    return os.path.join(os.path.dirname(sessions_dir()), "openpi.sock")


def run_fixed(prompt, cwd, timeout):
    """Drive one fixed prompt through the running daemon and time the turn.

    This is the controlled half of the baseline: the same prompt, the same
    workspace, every time. It needs the daemon running and a configured model,
    so it costs real tokens — unlike the offline analysis of past sessions.
    """
    path = socket_path()
    if not os.path.exists(path):
        print(f"daemon socket not found: {path}", file=sys.stderr)
        return None, 0.0
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    try:
        sock.connect(path)
    except OSError as exc:
        print(f"cannot connect to daemon: {exc}", file=sys.stderr)
        return None, 0.0
    stream = sock.makefile("rwb")

    def send(obj):
        stream.write((json.dumps(obj) + "\n").encode())
        stream.flush()

    send({"id": "cost-create", "type": "create_session", "cwd": cwd, "name": "cost-baseline"})
    started = time.time()
    sid = None
    deadline = started + timeout
    try:
        while time.time() < deadline:
            line = stream.readline()
            if not line:
                break
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            if msg.get("type") == "response" and msg.get("id") == "cost-create":
                if not msg.get("ok"):
                    print(f"create_session failed: {msg.get('error')}", file=sys.stderr)
                    return None, 0.0
                sid = (msg.get("data") or {}).get("sessionId")
                send({"id": "cost-sub", "type": "subscribe", "sessionId": sid})
                send({
                    "id": "cost-prompt",
                    "type": "rpc",
                    "sessionId": sid,
                    # `send_rpc` reads `command["message"]`. Sending "text" here
                    # silently delivers an empty prompt, and an empty prompt
                    # scores *better* on every metric in this report — which is
                    # how a broken harness fakes an improvement.
                    "command": {"type": "prompt", "message": prompt},
                })
            if (
                msg.get("type") == "event"
                and msg.get("sessionId") == sid
                and (msg.get("event") or {}).get("type") in ("agent_settled", "turn_end", "stream_error")
            ):
                break
    finally:
        stream.close()
        sock.close()
    return sid, time.time() - started


def verify_prompt_landed(sid, prompt):
    """Confirm the prompt really reached the session journal.

    Cheap insurance against the harness silently sending nothing: an empty turn
    looks fast and cheap, so the numbers would be meaningless without this.
    """
    for path in glob.glob(os.path.join(sessions_dir(), f"*{sid}*.jsonl")):
        try:
            with open(path, encoding="utf-8", errors="ignore") as fh:
                for line in fh:
                    try:
                        entry = json.loads(line)
                    except ValueError:
                        continue
                    if entry.get("type") != "message":
                        continue
                    msg = entry.get("message") or {}
                    if msg.get("role") != "user":
                        continue
                    for part in msg.get("content") or []:
                        if isinstance(part, dict) and prompt in (part.get("text") or ""):
                            return True
        except OSError:
            continue
    return False


def parse_ts(value):
    if not isinstance(value, str) or not value:
        return None
    try:
        return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def analyze(path):
    sid = os.path.basename(path)[:-6]
    turns = calls = tools = 0
    ins, outs = [], []
    first_in = None
    first_ts = last_ts = None
    try:
        fh = open(path, encoding="utf-8", errors="ignore")
    except OSError:
        return None
    with fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            ts = parse_ts(entry.get("timestamp"))
            if ts is not None:
                first_ts = ts if first_ts is None else min(first_ts, ts)
                last_ts = ts if last_ts is None else max(last_ts, ts)
            if entry.get("type") != "message":
                continue
            msg = entry.get("message") or {}
            role = msg.get("role")
            if role == "user":
                turns += 1
            elif role == "assistant":
                calls += 1
                usage = msg.get("usage") or {}
                n = usage.get("input")
                if isinstance(n, int) and n > 0:
                    if first_in is None:
                        first_in = n
                    ins.append(n)
                o = usage.get("output")
                if isinstance(o, int):
                    outs.append(o)
            for c in msg.get("content") or []:
                if isinstance(c, dict) and c.get("type") == "toolCall":
                    tools += 1
    if calls == 0:
        return None
    span = (last_ts - first_ts) if (first_ts is not None and last_ts is not None) else None
    return {
        "sid": sid,
        "turns": turns,
        "calls": calls,
        "tools": tools,
        "in_sum": sum(ins),
        "in_med": int(statistics.median(ins)) if ins else 0,
        "in_max": max(ins) if ins else 0,
        "first_in": first_in or 0,
        "out_sum": sum(outs),
        "span_s": round(span) if span else None,
        "mtime": os.path.getmtime(path),
    }


def aggregate(rows):
    def median_of(key):
        vals = [r[key] for r in rows if r.get(key)]
        return round(statistics.median(vals), 1) if vals else 0

    turns = sum(r["turns"] for r in rows)
    span_per_turn = [
        r["span_s"] / r["turns"] for r in rows if r["span_s"] and r["turns"] > 0
    ]
    return {
        "sessions": len(rows),
        "turns": turns,
        "in_med": median_of("in_med"),
        "in_max": max((r["in_max"] for r in rows), default=0),
        "first_in": median_of("first_in"),
        "calls_per_turn": round(sum(r["calls"] for r in rows) / max(1, turns), 2),
        "tools_per_turn": round(sum(r["tools"] for r in rows) / max(1, turns), 2),
        "span_per_turn_s": round(statistics.median(span_per_turn), 1) if span_per_turn else 0,
    }


def load_rows(args):
    sdir = sessions_dir()
    paths = sorted(glob.glob(os.path.join(sdir, "*.jsonl")), key=os.path.getmtime)
    if args.sid:
        paths = [p for p in paths if args.sid in os.path.basename(p)]
    if not args.all:
        paths = [p for p in paths if not os.path.basename(p).startswith(SKIP_PREFIXES)]
    if args.since:
        cutoff = dt.datetime.fromisoformat(args.since).timestamp()
        paths = [p for p in paths if os.path.getmtime(p) >= cutoff]
    if args.limit:
        paths = paths[-args.limit :]
    rows = [r for r in (analyze(p) for p in paths) if r]
    rows.sort(key=lambda r: r["mtime"])
    return rows


HEADER = f"{'date':12}{'sid':10}{'turns':>6}{'calls':>7}{'tools':>7}{'in_med':>9}{'in_max':>9}{'first_in':>9}{'out_sum':>9}{'span_s':>8}"


def print_table(rows):
    print(HEADER)
    for r in rows:
        d = dt.datetime.fromtimestamp(r["mtime"]).strftime("%m-%d %H:%M")
        span = r["span_s"] if r["span_s"] is not None else "-"
        print(
            f"{d:12}{r['sid'][:8]:10}{r['turns']:6}{r['calls']:7}{r['tools']:7}"
            f"{r['in_med']:9}{r['in_max']:9}{r['first_in']:9}{r['out_sum']:9}{str(span):>8}"
        )


def print_aggregate(agg):
    print("\naggregate")
    print(f"  sessions        {agg['sessions']}")
    print(f"  turns           {agg['turns']}")
    print(f"  in_med          {agg['in_med']}      (per-call context, tokens)")
    print(f"  in_max          {agg['in_max']}")
    print(f"  first_in        {agg['first_in']}      (fixed overhead proxy, tokens)")
    print(f"  calls/turn      {agg['calls_per_turn']}")
    print(f"  tools/turn      {agg['tools_per_turn']}")
    print(f"  span/turn_s     {agg['span_per_turn_s']}")


COMPARE_KEYS = ["in_med", "first_in", "calls_per_turn", "tools_per_turn", "span_per_turn_s"]


def compare(rows, baseline_path, threshold):
    with open(baseline_path, encoding="utf-8") as fh:
        baseline = json.load(fh)
    base = baseline.get("aggregate", {})
    cur = aggregate(rows)
    print(f"baseline: {baseline_path}  ({baseline.get('generatedAt', 'unknown')})")
    print(f"\n{'metric':16}{'baseline':>12}{'current':>12}{'delta':>10}")
    regressions = 0
    for key in COMPARE_KEYS:
        b = base.get(key, 0) or 0
        c = cur.get(key, 0) or 0
        pct = ((c - b) / b * 100) if b else 0.0
        flag = ""
        if b and pct > threshold:
            flag = "  <-- regression"
            regressions += 1
        print(f"{key:16}{b:>12}{c:>12}{pct:>9.1f}%{flag}")
    print(f"\nthreshold: +{threshold:.0f}%   regressions: {regressions}")
    return 1 if regressions else 0


def main():
    ap = argparse.ArgumentParser(description="OpenPI end-to-end cost baseline")
    ap.add_argument("--limit", type=int, help="only the N most recent sessions")
    ap.add_argument("--since", help="only sessions modified on/after YYYY-MM-DD")
    ap.add_argument("--sid", help="only sessions whose id contains this string")
    ap.add_argument("--all", action="store_true", help="include task/subagent sessions")
    ap.add_argument("--run", metavar="PROMPT", help="drive a fixed prompt through the daemon first")
    ap.add_argument("--cwd", default=os.getcwd(), help="workspace for --run (default: current dir)")
    ap.add_argument("--timeout", type=float, default=300.0, help="max seconds to wait for --run")
    ap.add_argument("--json", action="store_true", help="print the report as JSON")
    ap.add_argument("--save", metavar="PATH", help="write a baseline snapshot")
    ap.add_argument("--compare", metavar="PATH", help="compare against a saved baseline")
    ap.add_argument("--threshold", type=float, default=10.0, help="regression threshold %% (default 10)")
    args = ap.parse_args()

    wall = None
    if args.run:
        sid, wall = run_fixed(args.run, args.cwd, args.timeout)
        if not sid:
            return 3
        if not verify_prompt_landed(sid, args.run):
            print(
                "error: the prompt never reached the session journal — the run "
                "measured an empty turn, so its numbers are meaningless.\n"
                "       check that the prompt command still uses the `message` key.",
                file=sys.stderr,
            )
            return 4
        args.sid = sid
        print(f"ran fixed prompt on session {sid} in {wall:.1f}s\n")

    rows = load_rows(args)
    if not rows:
        print("no session journals found", file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps({"aggregate": aggregate(rows), "sessions": rows}, indent=2))
        return 0

    print_table(rows)
    print_aggregate(aggregate(rows))
    if wall is not None:
        print(f"\nfixed-run wall clock: {wall:.1f}s  (session {args.sid})")

    if args.save:
        payload = {
            "generatedAt": dt.datetime.now().isoformat(timespec="seconds"),
            "aggregate": aggregate(rows),
            "sessions": rows,
        }
        with open(args.save, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2)
        print(f"\nsaved baseline -> {args.save}")

    if args.compare:
        print()
        return compare(rows, args.compare, args.threshold)
    return 0


if __name__ == "__main__":
    sys.exit(main())
