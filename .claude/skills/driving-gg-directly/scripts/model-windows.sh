#!/usr/bin/env bash
# Print the `modelWindows`, `modelModalities` and `modelProviders` objects a gg invocation
# needs for the given OpenRouter model ids.
#
# The window and the modalities come from OpenRouter's public models endpoint. The provider
# pin comes from each model's endpoints listing: the route whose provider name belongs to
# the model's developer (the author segment of the id). A model with no such route is not
# testable, and this script fails naming it rather than printing a pin for another provider.
#
# gg keeps no model table of its own and refuses to launch a run whose invocation does not
# carry a context window and a provider pin for every bound model, so this is step one of
# any direct launch. Paste the three objects into the invocation file.
#
# Usage:
#   scripts/model-windows.sh x-ai/grok-4.7 moonshotai/kimi-k3
set -euo pipefail

if [ "$#" -eq 0 ]; then
	echo "usage: $0 <openrouter-model-id>..." >&2
	exit 2
fi

python3 - "$@" << 'PY'
import json, sys, urllib.request

def fetch(url):
    with urllib.request.urlopen(url, timeout=30) as response:
        return json.load(response)

def normalize(name):
    return "".join(ch for ch in name.lower() if ch not in " -_")

want = sys.argv[1:]
catalog = {m["id"]: m for m in fetch("https://openrouter.ai/api/v1/models")["data"]}
windows, modalities, providers, missing, unpinned = {}, {}, {}, [], []
for model_id in want:
    model = catalog.get(model_id)
    if model is None:
        missing.append(model_id)
        continue
    windows[model_id] = model["context_length"]
    modalities[model_id] = (model.get("architecture") or {}).get("input_modalities") or ["text"]
    endpoints = fetch(f"https://openrouter.ai/api/v1/models/{model_id}/endpoints")["data"]["endpoints"]
    author = normalize(model_id.split("/")[0].split(":")[0])
    pin = next(
        (
            (endpoint.get("provider_name") or "").strip()
            for endpoint in endpoints
            if normalize(endpoint.get("provider_name") or "") == author
        ),
        None,
    )
    if not pin:
        unpinned.append(model_id)
        continue
    providers[model_id] = pin

print(json.dumps({
    "modelWindows": windows,
    "modelModalities": modalities,
    "modelProviders": providers,
}, indent=2))
if missing:
    print("not on OpenRouter: " + ", ".join(missing), file=sys.stderr)
if unpinned:
    print(
        "no official endpoint (not testable): " + ", ".join(unpinned),
        file=sys.stderr,
    )
if missing or unpinned:
    sys.exit(1)
PY
