#!/usr/bin/env python3
"""Turn-economics report for a set of runs.

Pulls each run's record and normalized event stream from the backend, derives the
per-request ("turn") series each harness exposes, and prices every run on ONE
scale so harnesses that report cost differently stay comparable.

Usage:
    scripts/run-economics.py <run-id> [<run-id> ...]
    scripts/run-economics.py --case pong --limit 40          # discover by case slug
    scripts/run-economics.py --input 5.00 --output 30.00 <run-id> ...

Env:
    TCAB_BACKEND   backend base URL (default http://localhost:8787)
    TCAB_CACHE_DIR where pulled JSON is cached (default tmp/analysis)
"""

import argparse, json, os, sys, urllib.request, urllib.error
from collections import Counter

BACKEND = os.environ.get("TCAB_BACKEND", "http://localhost:8787")
CACHE = os.environ.get("TCAB_CACHE_DIR", "tmp/analysis")

# gg's task/context-management tools: turns containing only these did no work.
BOOKKEEPING = {
    "add_task", "update_task", "set_blocked_by", "complete_task", "remove_task",
    "evict_file_view", "compact",
}


def get(path):
    url = BACKEND + path
    try:
        with urllib.request.urlopen(url, timeout=120) as r:
            return json.loads(r.read())
    except urllib.error.URLError as e:
        sys.exit(f"error: {url}: {e}\n(is `make -C deployments/local local-forward` running?)")


def fetch(run_id):
    """Run record + events, cached on disk so re-runs are free."""
    os.makedirs(CACHE, exist_ok=True)
    out = {}
    for kind, path in (("run", f"/runs/{run_id}"), ("events", f"/runs/{run_id}/events")):
        f = os.path.join(CACHE, f"{run_id}.{kind}.json")
        if os.path.exists(f):
            out[kind] = json.load(open(f))
        else:
            out[kind] = get(path)
            json.dump(out[kind], open(f, "w"))
    return out


def usage_events(events):
    """Per-request usage, in order. gg nests its events under `event`; the
    others emit a top-level `usage`. Codex emits neither — see turn_note()."""
    out = []
    for e in events:
        if e.get("type") == "usage" and "tokens" in e:
            out.append(e["tokens"])
        ev = e.get("event")
        if isinstance(ev, dict) and ev.get("type") == "usage":
            out.append(ev["tokens"])
    return out


def gg_turns(events):
    """gg only: (tool names, first usage) per turn, plus the context_breakdown
    total. usage_input - breakdown_total is everything the breakdown cannot see:
    the tool-schema block AND the amount by which gg under-counts image tokens.
    Do NOT read it as the schema block alone — see unseen() and images()."""
    turns, cur, bd, pending = [], None, None, None
    for e in events:
        ev = e.get("event")
        if not isinstance(ev, dict):
            continue
        t = ev.get("type")
        if t == "turn_started":
            cur = {"calls": [], "tokens": None, "breakdown": None}
            turns.append(cur)
        elif t == "context_breakdown" and cur is not None:
            cur["breakdown"] = ev["totalTokens"]
        elif t == "tool_call" and cur is not None:
            cur["calls"].append(ev.get("tool") or ev.get("name"))
        elif t == "usage" and cur is not None and cur["tokens"] is None:
            cur["tokens"] = ev["tokens"]
    return turns


def gg_images(events):
    """(turn, path) for every image that enters gg's context. Images are billed by
    dimension (~1,130 tokens for a 1280x720 PNG) but gg's own per-message `tokens`
    estimate is far lower, so they are a large hidden term in the request."""
    out, turn = [], 0
    for e in events:
        ev = e.get("event")
        if not isinstance(ev, dict):
            continue
        if ev.get("type") == "turn_started":
            turn += 1
        elif ev.get("type") == "context_message" and ev.get("images"):
            head = (ev.get("content") or "").strip().split("\n")[0]
            path = head.split("`")[1] if "`" in head else head[:28]
            out += [(turn, path)] * len(ev["images"])
    return out


def money(v):
    return f"${v:,.4f}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("run_ids", nargs="*")
    ap.add_argument("--case", help="discover runs by test-case slug instead of listing ids")
    ap.add_argument("--limit", type=int, default=40)
    ap.add_argument("--input", type=float, default=5.00, help="base input $/M")
    ap.add_argument("--output", type=float, default=30.00, help="output $/M")
    ap.add_argument("--write-multiplier", type=float, default=1.25,
                    help="cache-write premium applied to all non-cache-read input")
    ap.add_argument("--read-fraction", type=float, default=0.10,
                    help="cache-read price as a fraction of base input")
    args = ap.parse_args()

    p_write = args.input * args.write_multiplier / 1e6
    p_read = args.input * args.read_fraction / 1e6
    p_out = args.output / 1e6

    ids = list(args.run_ids)
    if args.case:
        listing = get(f"/runs?state=review&limit={args.limit}&fields=summary")
        ids += [r["id"] for r in listing["runs"]
                if r["subject"]["testCaseSlug"] == args.case]
    if not ids:
        sys.exit("error: give run ids or --case <slug>")

    print(f"normalized: cache-write ${args.input * args.write_multiplier:.2f}/M · "
          f"cache-read ${args.input * args.read_fraction:.2f}/M · output ${args.output:.2f}/M\n")

    rows = []
    for rid in ids:
        d = fetch(rid)
        rec = d["run"]["record"]
        m = rec["metrics"]
        tk = m["tokens"]
        write = tk["uncachedInput"]
        read = tk["cachedInput"]
        out = tk["output"] + (tk.get("reasoning") or 0)
        norm = write * p_write + read * p_read + out * p_out
        s = rec["subject"]
        caps = s.get("ggCapabilitySet") or {}
        summ = s.get("ggSummary") or {}
        preset = caps.get("preset")
        label = s["harnessSlug"] + (f"/{preset}" if preset else "")
        tools = tuple(summ.get("effectiveTools") or ())
        mode = summ.get("executionMode")

        series = usage_events(d["events"])
        turns = len(series) or None
        ggt = gg_turns(d["events"]) if s["harnessSlug"] == "gg" else []
        book = [t for t in ggt if t["calls"] and set(t["calls"]) <= BOOKKEEPING]
        unseen = None
        if ggt and ggt[0]["tokens"] and ggt[0]["breakdown"]:
            first = ggt[0]["tokens"]
            unseen = first["uncachedInput"] + first["cachedInput"] - ggt[0]["breakdown"]
        imgs = gg_images(d["events"])

        rows.append(dict(
            id=rid, label=label, billed=m["cost"]["actual"], norm=norm,
            write=write, read=read, out=out, turns=turns,
            calls=sum(len(t["calls"]) for t in ggt) or None,
            book=len(book) or None, book_in=sum(
                t["tokens"]["uncachedInput"] + t["tokens"]["cachedInput"]
                for t in book if t["tokens"]) or None,
            unseen=unseen, imgs=imgs, tools=tools, mode=mode,
            ctx=[t["uncachedInput"] + t["cachedInput"] for t in series],
        ))

    w = max(len(r["label"]) for r in rows)
    print(f"{'run':10s} {'harness':{w}s} {'turns':>5s} {'write in':>9s} {'read in':>10s} "
          f"{'out+rea':>8s} {'ctx/turn':>9s} {'billed':>9s} {'NORMALIZED':>11s}")
    for r in sorted(rows, key=lambda r: r["norm"]):
        t = f"{r['turns']}" if r["turns"] else "  n/a"
        c = f"{(r['write'] + r['read']) // r['turns']:,}" if r["turns"] else "n/a"
        print(f"{r['id'][:9]:10s} {r['label']:{w}s} {t:>5s} {r['write']:9,} {r['read']:10,} "
              f"{r['out']:8,} {c:>9s} {money(r['billed']):>9s} {money(r['norm']):>11s}")

    # Group by (harness/preset, effective tool set): a preset name is mutable, so
    # two runs can share a name and not a configuration. Never average those.
    groups = {}
    for r in rows:
        groups.setdefault((r["label"], r["tools"]), []).append(r)
    names = Counter(k[0] for k in groups)
    groups = {(k[0] if names[k[0]] == 1 else f"{k[0]} ({len(k[1])} tools)"): v
              for k, v in groups.items()}
    if len(groups) > 1:
        gw = max(len(k) for k in groups)
        print(f"\n{'harness':{gw}s} {'n':>2s} {'turns':>6s} {'$write':>8s} {'$read':>8s} "
              f"{'$out':>8s} {'NORMALIZED':>11s}")
        base = None
        for label, rs in sorted(groups.items(), key=lambda kv: sum(x["norm"] for x in kv[1]) / len(kv[1])):
            n = len(rs)
            W = sum(x["write"] for x in rs) / n
            R = sum(x["read"] for x in rs) / n
            O = sum(x["out"] for x in rs) / n
            T = [x["turns"] for x in rs if x["turns"]]
            tot = W * p_write + R * p_read + O * p_out
            base = base or tot
            tt = f"{sum(T) / len(T):.1f}" if T else "   n/a"
            print(f"{label:{gw}s} {n:2d} {tt:>6s} {money(W * p_write):>8s} {money(R * p_read):>8s} "
                  f"{money(O * p_out):>8s} {money(tot):>11s}  {tot / base:.2f}x")

    gg = [r for r in rows if r["mode"]]
    if gg:
        print("\ngg detail")
        for r in sorted(gg, key=lambda r: r["norm"]):
            bits = [f"{r['mode']}"]
            if r["calls"] and r["turns"]:
                bits.append(f"{r['calls']} calls / {r['turns']} turns = {r['calls'] / r['turns']:.2f} per turn")
            if r["book"]:
                bits.append(f"{r['book']} bookkeeping-only turns burning {r['book_in']:,} input tokens")
            elif r["calls"]:
                bits.append("no bookkeeping-only turns")
            if r["unseen"]:
                bits.append(f"{r['unseen']:,} tokens/turn outside context_breakdown "
                            f"(tool schemas + image undercount)")
            print(f"  {r['id'][:9]}  " + " · ".join(bits))
            print(f"             tools: {', '.join(r['tools']) or '(none recorded)'}")
            if r["imgs"]:
                first = [i for i in r["imgs"] if i[0] == 1]
                print(f"             images: {len(r['imgs'])} in context "
                      f"({len(first)} seeded at turn 1, carried on every request): "
                      + ", ".join(f"t{t}:{p}" for t, p in r["imgs"]))

        # A preset is a mutable saved config: the same NAME can cover different
        # capability sets across runs. Comparing those as one group is wrong.
        by_preset = {}
        for r in gg:
            by_preset.setdefault(r["label"], set()).add(r["tools"])
        for label, sets in by_preset.items():
            if len(sets) > 1:
                print(f"\n  WARNING: {len(sets)} different tool sets share the preset name "
                      f"'{label}'.\n  The saved config was edited between runs — do not "
                      f"average them. Group by the\n  tools line above, or pass explicit run "
                      f"ids per configuration.")

    if any(r["turns"] for r in rows):
        print("\nper-turn input tokens")
        for r in sorted(rows, key=lambda r: r["norm"]):
            if r["ctx"]:
                print(f"  {r['id'][:9]} {r['label']:{w}s} "
                      + " ".join(f"{c // 1000}k" for c in r["ctx"]))

    missing = [r["id"] for r in rows if not r["turns"]]
    if missing:
        print(f"\nno per-request usage for {len(missing)} run(s) — codex reports only a "
              f"session total. Turn count must be inferred from item.completed lines in\n"
              f"tmp/assets/<run-id>/raw.jsonl (scripts/extract-assets.sh <run-id>); "
              f"cost above is exact regardless.")


if __name__ == "__main__":
    main()
