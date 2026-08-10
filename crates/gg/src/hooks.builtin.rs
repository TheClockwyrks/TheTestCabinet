//! The **hook scripts gg ships** — the sources behind
//! [`GgHookAction::BuiltIn`](test_cabinet_core::gg::GgHookAction::BuiltIn).
//!
//! Three of them, and the list is meant to stay short. A built-in earns its place where what it
//! knows is genuinely gg's — the shape of an event payload — rather than where it saves an operator
//! from writing a script; anything that depends on a particular workspace belongs in a
//! [custom](test_cabinet_core::gg::GgHookAction::Custom) hook, which runs by exactly the same
//! contract.
//!
//! That contract is why these are written the way they are. Each is a POSIX shell script with a
//! `#!` line, reads the event from `$1`, and prints one decision object on stdout — so each is
//! also a **worked example** an operator can copy into a custom hook and change. They use `python3`
//! for the JSON reading rather than shelling out to `jq`, because the run container is built on a
//! Python-bearing base image and `jq` is not something gg guarantees.

/// The source of the built-in hook script called `id`, or `None` when gg ships no such script.
///
/// The lookup [launch resolution](super::HookRuntime::resolve) validates a configuration's
/// `builtIn` ids against, so a typo is a launch error rather than a hook that quietly never fires.
pub(crate) fn builtin_source(id: &str) -> Option<&'static str> {
    match id.trim() {
        "trace" => Some(TRACE),
        "refuse-empty-write" => Some(REFUSE_EMPTY_WRITE),
        "guard-destructive-shell" => Some(GUARD_DESTRUCTIVE_SHELL),
        _ => None,
    }
}

/// Report every event to the operator log and let it through.
///
/// The first hook to reach for, because "does this event fire, and with what?" is the question
/// every other hook starts from — and the payload's shape is otherwise only readable in gg's own
/// source. It answers on the **message** channel rather than by writing to stderr so that what it
/// reports lands where the run is read.
const TRACE: &str = r#"#!/bin/sh
# gg built-in hook: trace
#
# Prints the whole event payload back as a message, then continues. Bind it to an event you are
# unsure about, read one firing, and write the real hook against what you saw.
python3 - "$1" <<'PY'
import json, sys

event = json.loads(sys.argv[1])
name = event.get("event", "?")
agent = event.get("agent", "?")
body = json.dumps(event, indent=2, sort_keys=True)
print(json.dumps({
    "action": "message",
    "message": f"{name} fired for agent {agent}:\n{body}",
}))
PY
"#;

/// Refuse a write whose contents are empty or whitespace.
///
/// The reasoning is that a model which truncates a file to nothing has almost always *lost* the
/// file rather than meant to empty it — a half-generated response, a bad edit — and the failure is
/// silent otherwise: the write succeeds, the model believes the file is written, and the damage is
/// found much later by something that reads it.
///
/// Deliberately narrow. It lets every non-empty write through and every non-write event through
/// untouched, so binding it to the wrong event is inert rather than surprising.
const REFUSE_EMPTY_WRITE: &str = r#"#!/bin/sh
# gg built-in hook: refuse-empty-write
#
# Blocks a pre-write whose contents are empty or whitespace. Everything else continues.
python3 - "$1" <<'PY'
import json, sys

event = json.loads(sys.argv[1])
contents = event.get("contents")
path = event.get("path", "the file")

if isinstance(contents, str) and contents.strip() == "":
    print(json.dumps({
        "action": "block",
        "reason": (
            f"Refusing to write empty contents to {path}. If you meant to clear the file, say so "
            "explicitly with a shell command; if you did not, your previous response was probably "
            "truncated — write the whole file again."
        ),
    }))
else:
    print(json.dumps({"action": "continue"}))
PY
"#;

/// Refuse the three shell commands that reach past the run.
///
/// `git push` publishes, `git reset --hard` destroys work the run has not recorded anywhere else,
/// and an `rm -rf` with an absolute path or a `..` in it leaves the workspace. All three are
/// things a model occasionally reaches for while tidying up, and none of them is recoverable from
/// inside the run.
///
/// It matches on the command text, which is a *heuristic* and is documented as one: a determined
/// command can evade it (`git  push`, an alias, a script). It is a guard rail, not a sandbox — the
/// sandbox is the container.
const GUARD_DESTRUCTIVE_SHELL: &str = r#"#!/bin/sh
# gg built-in hook: guard-destructive-shell
#
# Blocks a pre-shell command that pushes, hard-resets, or recursively removes outside the
# workspace. Matches on the command text: a guard rail, not a sandbox.
python3 - "$1" <<'PY'
import json, re, sys

event = json.loads(sys.argv[1])
command = event.get("command", "")
normalized = " ".join(command.split())

def refuse(reason):
    print(json.dumps({"action": "block", "reason": reason}))
    sys.exit(0)

if re.search(r"\bgit\s+push\b", normalized):
    refuse(
        "Refusing `git push`: this run's work is collected from its workspace, and publishing it "
        "from inside the run is not part of the task. Commit locally instead."
    )

if re.search(r"\bgit\s+reset\s+--hard\b", normalized):
    refuse(
        "Refusing `git reset --hard`: it would discard work that exists nowhere else. If you need "
        "to undo something, revert the specific files."
    )

for match in re.finditer(r"\brm\s+(?:-[a-zA-Z]+\s+)*(\S+)", normalized):
    target = match.group(1)
    if ("r" in match.group(0) or "R" in match.group(0)) and (
        target.startswith("/") or ".." in target
    ):
        refuse(
            f"Refusing a recursive remove of `{target}`, which is outside this run's workspace. "
            "Delete paths inside the workspace instead."
        )

print(json.dumps({"action": "continue"}))
PY
"#;
