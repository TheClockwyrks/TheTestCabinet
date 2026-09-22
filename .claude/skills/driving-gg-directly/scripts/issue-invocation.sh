#!/usr/bin/env bash
# Instantiate templates/invocation.study.json for one model, one mode and one issue.
#
# Usage:
#   scripts/issue-invocation.sh <openrouter-model-id> <purescript|typescript|javascript|python|tools> <tasks-file> <workspace-dir> > inv.json
#
# `tools` drops the responses-as-code capability and leaves `operations` empty, which is
# the tool-calling arm; any language keeps it and leaves `tools` empty, which is the
# responses-as-code arm. Model windows come from scripts/model-windows.sh.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
if [ "$#" -ne 4 ]; then
	sed -n 2,9p "$0" >&2
	exit 2
fi
model="$1" mode="$2" issue="$3" workspace="$4"
windows="$("$here/model-windows.sh" "$model")"
python3 - "$here/../templates/invocation.study.json" "$model" "$mode" "$issue" "$workspace" "$windows" <<'PY'
import json, re, sys
tpl, model, mode, issue, workspace, windows = sys.argv[1:]
inv = json.load(open(tpl))
w = json.loads(windows)
inv["modelWindows"] = w["modelWindows"]
inv["modelModalities"] = w["modelModalities"]
slug = lambda s: re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
issue_slug = slug(re.sub(r"\.md$", "", issue.rsplit("/", 1)[-1]))
inv["sessionId"] = f"gg-{issue_slug}-{slug(model)}-{mode}"
inv["workspaceDir"] = workspace
inv["prompt"] = (
    "The workspace is the repository this issue describes. Implement the issue below. "
    "Run the gates it names before you finish, commit the change with a Conventional Commits "
    "message, and end your session by calling finish with a short summary once the change is "
    "complete.\n\n" + open(issue).read()
)
agent = inv["capabilitySet"]["agents"][0]
agent["modelId"] = model
if mode == "tools":
    agent["capabilities"] = [c for c in agent["capabilities"] if c["id"] != "responses-as-code"]
    agent["operations"] = []
else:
    for c in agent["capabilities"]:
        if c["id"] == "responses-as-code":
            c["params"]["language"] = mode
    agent["tools"] = []
json.dump(inv, sys.stdout, indent=2)
print()
PY
