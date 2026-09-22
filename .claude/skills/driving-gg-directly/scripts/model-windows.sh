#!/usr/bin/env bash
# Print the `modelWindows` and `modelModalities` objects a gg invocation needs for the
# given OpenRouter model ids, read from OpenRouter's public models endpoint (no key).
#
# gg keeps no model table of its own and refuses to launch a run whose invocation does
# not carry a context window for every bound model, so this is step one of any direct
# launch. Paste the two objects into the invocation file.
#
# Usage:
#   scripts/model-windows.sh x-ai/grok-4.7 moonshotai/kimi-k3
set -euo pipefail

if [ "$#" -eq 0 ]; then
	echo "usage: $0 <openrouter-model-id>..." >&2
	exit 2
fi

curl -fsS --max-time 30 "https://openrouter.ai/api/v1/models" | python3 -c '
import json, sys
want = sys.argv[1:]
catalog = {m["id"]: m for m in json.load(sys.stdin)["data"]}
windows, modalities, missing = {}, {}, []
for id in want:
    m = catalog.get(id)
    if m is None:
        missing.append(id)
        continue
    windows[id] = m["context_length"]
    modalities[id] = (m.get("architecture") or {}).get("input_modalities") or ["text"]
print(json.dumps({"modelWindows": windows, "modelModalities": modalities}, indent=2))
if missing:
    print("not on OpenRouter: " + ", ".join(missing), file=sys.stderr)
    sys.exit(1)
' "$@"
