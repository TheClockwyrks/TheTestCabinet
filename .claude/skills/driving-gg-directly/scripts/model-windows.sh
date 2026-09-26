#!/usr/bin/env bash
# Print the `modelWindows`, `modelModalities` and `modelProviders` objects a gg invocation
# needs for the given OpenRouter model ids.
#
# The window and the modalities come from OpenRouter's public models endpoint. The provider
# candidate list comes from each model's endpoints listing, under the filters the backend
# applies at enqueue (`provider_candidates` in crates/core/src/pricing.candidates.rs; the
# candidate list in apps/docs/src/content/docs/gg/overview.md). An endpoint is kept when:
#   - it serves the model's native quantization (the best level any endpoint declares, or
#     --native); an `unknown` endpoint only when its provider is named by --unknown-ok;
#   - its input and output prices are at or below the developer endpoint's (the endpoint whose
#     provider is the id's author segment, or --developer), or --max-price when the listing
#     prices no developer endpoint;
#   - it publishes a cache-read price;
#   - it supports `tools` and `tool_choice`, and `reasoning` under --reasoning;
#   - its provider is not named by --ban.
# One candidate per provider, at its cheapest passing endpoint. The developer comes first, the
# rest by input price, output price, then name. The backend also orders by each provider's
# recorded fault rate before price; this script has no fault record and skips that key.
# The per-candidate prices and the native level go to stderr; stdout is the three objects.
#
# gg keeps no model table of its own and refuses to launch a run whose invocation does not
# carry a context window and a candidate list for every bound model, so this is step one of
# any direct launch. Paste the three objects into the invocation file. A model with no
# candidate is not testable as configured; the script names the filter that emptied its list
# and exits 1.
#
# Every option applies to every model on the command line; run one model per call when they
# differ. Repeat --ban and --unknown-ok for several providers. Provider names compare ignoring
# case and punctuation, so `z-ai` and `Z.AI` are one provider.
#
# Usage:
#   scripts/model-windows.sh [--reasoning] [--ban PROVIDER]... [--unknown-ok PROVIDER]...
#       [--developer PROVIDER] [--max-price IN,OUT] [--native LEVEL] <openrouter-model-id>...
#   (--max-price is USD per million tokens, e.g. --max-price 0.60,2.20)
#
# Example:
#   scripts/model-windows.sh --reasoning x-ai/grok-4.7 moonshotai/kimi-k3
set -euo pipefail

if [ "$#" -eq 0 ] || [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
	sed -n 32,35p "$0" >&2
	exit 2
fi

python3 - "$@" << 'PY'
import json, sys, urllib.request

# Best first; one width shares a rank. `unknown` is not a level.
RANK = {"fp32": 0, "bf16": 1, "fp16": 1, "fp8": 2, "int8": 2, "fp6": 3, "fp4": 4, "int4": 4}

def usage(message):
    print(f"model-windows.sh: {message} (see --help)", file=sys.stderr)
    sys.exit(2)

def fetch(url):
    with urllib.request.urlopen(url, timeout=30) as response:
        return json.load(response)

def key(name):
    # One provider, however OpenRouter spells it: `Z.AI` and `z-ai` agree.
    return "".join(ch for ch in name.lower() if ch.isalnum())

def same(a, b):
    return key(a) != "" and key(a) == key(b)

def price(value):
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None

args = sys.argv[1:]
want, banned, unknown_ok = [], [], []
developer_override = native_override = ceiling = None
reasoning = False
while args:
    arg = args.pop(0)
    if arg == "--reasoning":
        reasoning = True
    elif arg in ("--ban", "--unknown-ok", "--developer", "--max-price", "--native"):
        if not args:
            usage(f"{arg} needs a value")
        value = args.pop(0)
        if arg == "--ban":
            banned.append(value)
        elif arg == "--unknown-ok":
            unknown_ok.append(value)
        elif arg == "--developer":
            developer_override = value.strip()
        elif arg == "--native":
            native_override = value.strip().lower() or None
        else:
            parts = [price(part) for part in value.split(",")]
            if len(parts) != 2 or None in parts:
                usage("--max-price takes IN,OUT in USD per million tokens")
            ceiling = (parts[0] / 1e6, parts[1] / 1e6)
    elif arg.startswith("-"):
        usage(f"unknown option {arg}")
    else:
        want.append(arg)
if not want:
    usage("no model id given")

parameters = ["tools", "tool_choice"] + (["reasoning"] if reasoning else [])

def offers_of(endpoints):
    offers = []
    for endpoint in endpoints:
        provider = (endpoint.get("provider_name") or "").strip()
        if not provider:
            continue
        pricing = endpoint.get("pricing") or {}
        offers.append({
            "provider": provider,
            "quantization": (endpoint.get("quantization") or "").strip().lower() or "unknown",
            "input": price(pricing.get("prompt")),
            "output": price(pricing.get("completion")),
            "cache_read": price(pricing.get("input_cache_read")),
            "parameters": [p.strip().lower() for p in endpoint.get("supported_parameters") or []],
        })
    return offers

def candidates(model_id, offers):
    """Return (native, developer, candidates) or raise ValueError naming the emptying filter."""
    if not offers:
        raise ValueError("OpenRouter lists no endpoint for it")
    ranked = [RANK[o["quantization"]] for o in offers if o["quantization"] in RANK]
    native = native_override
    if native is None and ranked:
        best = min(ranked)
        native = next(o["quantization"] for o in offers if RANK.get(o["quantization"]) == best)
    if native is None:
        raise ValueError(
            "no endpoint declares a quantization level, and no --native level is given"
        )
    author = model_id.split("/")[0].split(":")[0]
    developer = developer_override or next(
        (o["provider"] for o in offers if same(o["provider"], author)), None
    )
    is_dev = lambda o: developer is not None and same(o["provider"], developer)
    rates = next(
        ((o["input"], o["output"]) for o in offers
         if is_dev(o) and o["input"] is not None and o["output"] is not None),
        None,
    ) or ceiling
    if rates is None:
        raise ValueError(
            "OpenRouter lists no priced endpoint from its developer, and no --max-price "
            "ceiling is given"
        )
    native_rank = RANK.get(native)
    kept = [
        o for o in offers
        if (native_rank is not None and RANK.get(o["quantization"]) == native_rank)
        or o["quantization"] == native
        or (o["quantization"] == "unknown" and any(same(a, o["provider"]) for a in unknown_ok))
    ]
    if not kept:
        raise ValueError(
            f"no endpoint serves it at its native quantization `{native}` (an `unknown` "
            "endpoint counts only when --unknown-ok names the provider)"
        )
    kept = [
        o for o in kept
        if o["input"] is not None and o["input"] <= rates[0]
        and o["output"] is not None and o["output"] <= rates[1]
    ]
    if not kept:
        raise ValueError("every endpoint at its native quantization is priced above the ceiling")
    kept = [o for o in kept if o["cache_read"] is not None]
    if not kept:
        raise ValueError(
            "no endpoint at its native quantization within the ceiling publishes a "
            "cache-read price"
        )
    kept = [o for o in kept if all(p in o["parameters"] for p in parameters)]
    if not kept:
        raise ValueError(
            "no endpoint left supports every parameter the run sends ("
            + ", ".join(parameters) + ")"
        )
    kept = [o for o in kept if not any(same(b, o["provider"]) for b in banned)]
    if not kept:
        raise ValueError("every endpoint left is on the --ban list")
    price_order = lambda o: (o["input"], o["output"], o["provider"])
    cheapest = {}
    for o in kept:
        k = key(o["provider"])
        if k not in cheapest or price_order(o) < price_order(cheapest[k]):
            cheapest[k] = o
    ordered = sorted(cheapest.values(), key=lambda o: (not is_dev(o),) + price_order(o))
    return native, developer, [dict(o, developer=is_dev(o)) for o in ordered]

catalog = {m["id"]: m for m in fetch("https://openrouter.ai/api/v1/models")["data"]}
windows, modalities, providers, missing, refused = {}, {}, {}, [], []
per_mtok = lambda p: f"{p * 1e6:.4g}"
for model_id in want:
    model = catalog.get(model_id)
    if model is None:
        missing.append(model_id)
        continue
    windows[model_id] = model["context_length"]
    modalities[model_id] = (model.get("architecture") or {}).get("input_modalities") or ["text"]
    endpoints = fetch(f"https://openrouter.ai/api/v1/models/{model_id}/endpoints")["data"]["endpoints"]
    try:
        native, developer, found = candidates(model_id, offers_of(endpoints))
    except ValueError as reason:
        refused.append(f"{model_id}: {reason}")
        continue
    providers[model_id] = [
        {"provider": c["provider"], "quantization": c["quantization"]} for c in found
    ]
    print(
        f"{model_id}: native {native}, developer {developer or '(none; --max-price ceiling)'}, "
        f"parameters {', '.join(parameters)}",
        file=sys.stderr,
    )
    for n, c in enumerate(found, 1):
        print(
            f"  {n}. {c['provider']} ({c['quantization']})"
            f"{' [developer]' if c['developer'] else ''}"
            f"  in {per_mtok(c['input'])} / out {per_mtok(c['output'])}"
            f" / cache-read {per_mtok(c['cache_read'])} USD/Mtok",
            file=sys.stderr,
        )

print(json.dumps({
    "modelWindows": windows,
    "modelModalities": modalities,
    "modelProviders": providers,
}, indent=2))
if missing:
    print("not on OpenRouter: " + ", ".join(missing), file=sys.stderr)
for line in refused:
    print("no provider candidate (not testable as configured): " + line, file=sys.stderr)
if missing or refused:
    sys.exit(1)
PY
