---
title: "Hooks"
---

A **hook** is a command or a script gg runs at one of ten points in a run — around a file
write, around a shell command, around a compaction, as an agent starts or tries to stop,
and at the session's two ends. What a hook can do is deliberately narrow, and the same two
things everywhere:

- **Block** the operation it precedes, and
- **put text in front of the model**.

```jsonc
{
  "hooks": [
    {
      "event": "agent-stop",
      "name": "the build must pass",
      "action": { "type": "command", "command": "npm run build" }
    },
    {
      "event": "pre-write",
      "action": { "type": "built-in", "script": "refuse-empty-write" }
    }
  ]
}
```

## Why this is not a capability

Everything else gg configures is a [capability](/gg/overview/): a feature the model is
offered, an arm a study ablates. A hook is the opposite end of the telescope — the
**operator** reaching into the run from outside it. The model is never told a hook exists,
is offered no tool for one, and cannot decline one; a blocked write comes back looking
like a refusal from the harness, because that is what it is.

So hooks are declared **once for the whole run**, beside the
[execution ceilings](/gg/execution-limits/) rather than on an agent, and they never appear
in the `cap.*` [query](/gg/analysis/query-language/) namespace. Several of the events are
not an agent's at all — a session starting, a compaction — and the ones that are fire for
*every* agent, so hanging them off one profile's capability list would have made "run this
before every write" a thing an operator had to remember to repeat.

This is also where the old `completion` capability went. Its validation commands were a
gate on one event (an agent ending) expressed as a capability, which meant they applied to
whichever profiles remembered to enable it and could express nothing but "run this,
non-zero is a failure". As an [`agent-stop`](#agent-stop) command hook they are the same
gate, spelled once, for every agent — and a run that wants more than an exit code can now
reach for a script instead.

## The events

Ten events in four `pre`/`post` pairs plus the session's two ends. The pairing is the
whole design: a `pre-` event runs **before** its operation and is the only kind that can
stop it, while a `post-` event runs after and can only add to what the model is told. You
can answer "can this hook block?" from the event's name alone, without knowing what the
hook does — which is the property a gate has to have to be trustworthy.

| Event | Fires | Can block | Can insert | Payload beyond the [agent facts](#every-payload-carries-the-agent) |
| --- | --- | --- | --- | --- |
| `pre-write` | Before a file write of any kind | **yes** | yes | `path` (absolute), `contents` |
| `post-write` | After the file is updated | no | yes | `path`, `contents`, `ok` |
| `pre-shell` | Before a shell command runs | **yes** | yes | `command` |
| `post-shell` | After it has run | no | yes | `command`, `ok` |
| `pre-compact` | Before a [compaction](/gg/compaction/) | no | no | `strategy` |
| `post-compact` | After the window is rewritten | no | yes | `strategy` |
| `agent-start` | When any agent instance starts | no | yes | — |
| `agent-stop` | When any agent tries to end | **yes** | yes | `call` |
| `session-start` | Once, before the root's first turn | no | yes | — |
| `session-end` | Once, after the root finishes | no | no | `status` |

Two of those rows are exceptions worth naming, because in both cases the obvious reading
is wrong:

- **`pre-compact` is a `pre-` event that cannot block.** Compaction happens because the
  window is full; refusing it would leave the agent with no room to do anything at all, so
  the only honest thing a hook can do there is observe. It cannot insert either — the
  window it would insert into is the one being rewritten.
- **`session-end` cannot insert.** It fires after the last turn anybody could read it on.
  It is where a run reports on itself.

A hook that blocks a non-blocking event, or returns a message on an event with no prompt
to insert into, is reported to the operator as a **misconfiguration** and not honored —
rather than silently dropped, which would leave its author believing they had a gate.

### Every payload carries the agent

Whatever the event, the JSON a script is handed carries who it is firing for:

```jsonc
{
  "event": "pre-write",
  "agentId": "agent-3",          // the instance's id, its handle in the tree
  "agent": "Implementer",        // the agent PROFILE's name
  "agentKind": "issue-implementer",  // root | issue-implementer | issue-reviewer | subagent
  "worktree": { "branch": "gg/issue-1", "path": "/w/issue-1" },  // or null
  "path": "/w/issue-1/src/main.rs",  // the event's own fields, beside the agent's
  "contents": "…"
}
```

A hook is a run-level declaration firing on per-agent events, so a script asked to decide
about a write has no other way to know which of a dozen concurrent agents is writing — or
whether that agent is working in an [isolated worktree](/gg/project-management/), where
the path it is being shown means something different from the same path in the main tree.
That is also why `path` is **absolute**.

`agentKind` is the **role the instance was dispatched in**, not its profile: the same
profile implements an issue in one dispatch and reviews one in the next, and "block a
reviewer that approves without reading the diff" is meaningless if it also fires on the
implementer.

### `agent-stop`

The ending gate, and the event most runs reach for first. A blocking hook here hands its
reason back to the model and **the session continues**, so the model fixes the problem and
declares it is done again — exactly as the `completion` capability's validation commands
used to behave, now for every agent and in both [execution modes](/gg/responses-as-code/).

A run that can never satisfy the gate does not hang: it goes on taking turns until it
trips a [ceiling](/gg/execution-limits/), which is a diagnosis rather than a silence.

## The three kinds

### Command

Run a command line, exactly as the [shell tool](/gg/shell/) runs one. It receives **no
input** — not the event payload, not anything on stdin — because the checks that are
already commands (`npm test`, `cargo clippy`) read the workspace rather than being told
about it. A hook that needs to know what is being written wants a [script](#custom).

A **non-zero exit blocks** (on an event that can block), and either way the command's
output is put in front of the model. The output goes through the agent's own
[offloading policy](/gg/shell/), so a failing test suite that prints a megabyte behaves
the way a megabyte of `shell` output does: the tail inline, the whole of it on disk to
grep.

```jsonc
{
  "event": "agent-stop",
  "name": "tests",
  "action": {
    "type": "command",
    "command": "npm test",
    "cwd": "web",          // relative to the agent's workspace, or absolute
    "timeoutSecs": 600,    // default 300
    "output": "inline"     // or omit, to follow the agent's own shell configuration
  }
}
```

### Built-in

Run one of gg's own hook scripts by id. Same contract as a [custom](#custom) one in every
respect, with the source coming from gg instead of the configuration — a built-in is meant
to be a worked example you can read, copy into a custom hook, and change.

| Id | What it does |
| --- | --- |
| `trace` | Report every event it receives back as a message, and continue. The first hook to reach for, because "does this event fire, and with what?" is the question every other hook starts from. |
| `refuse-empty-write` | Block a write whose contents are empty or whitespace — a model that truncates a file to nothing has usually *lost* it rather than meant to empty it. Every other write, and every non-write event, passes. |
| `guard-destructive-shell` | Block a shell command that would `git push`, `git reset --hard`, or recursively remove a path outside the workspace. A guard rail, not a sandbox: it matches on the command text, and a determined command can evade it. |

An id gg does not ship is reported as a **launch warning** and the hook is dropped, with
the message naming the ids that do exist — because the failure is almost always a typo,
and a list is the shortest path from the message to the fix.

### Custom

Run a script the configuration carries verbatim. gg writes it to `.gg/hooks/` in the run's
workspace, makes it executable, and runs it with the event payload as its **sole
argument** — a JSON string, not a stream, so a script reads its input without a parser for
the reading. A leading `#!` line chooses the interpreter; a script without one is run by
`sh`.

The script must exit `0` and print **one decision object** on stdout:

```jsonc
{"action": "continue"}
{"action": "block", "reason": "why the operation was refused"}
{"action": "message", "message": "text put in front of the model"}
```

A tagged union rather than a bag of optional fields, because the three outcomes are
genuinely exclusive: `{"action": "block"}` with a `message` beside it would leave gg
guessing whether the message was the reason for the block or an insertion the author also
wanted, so there is no such object.

Only the **last non-empty line** is parsed, so a script that logged its way to a decision
— the natural way to write one — is not punished for it.

```sh
#!/bin/sh
# Refuse a write to anything under `vendor/`.
python3 - "$1" <<'PY'
import json, sys
event = json.loads(sys.argv[1])
path = event.get("path", "")
if "/vendor/" in path:
    print(json.dumps({"action": "block", "reason": f"{path} is vendored; do not edit it."}))
else:
    print(json.dumps({"action": "continue"}))
PY
```

## Failure is not a verdict

A script that exits non-zero, or prints something gg cannot parse, has **not judged
anything**. Letting the operation through would be pretending it passed; blocking it would
be pretending it failed. Both are lies about a gate an operator is relying on, so gg does
neither: it **stops the run**, with the script's own output on the operator stream and a
terminal status of `hook_error`.

This is the one place in gg where a misbehaving subprocess is fatal rather than fed back
to the model, and it is fatal precisely because the model is not the one who asked for it
— there is nobody to hand the question to. Note the distinction from a **command** hook,
where a non-zero exit is a *verdict* (the check ran and failed) rather than a breakage.

The single exception is `session-end`, whose failure is logged and otherwise ignored:
stopping a run that has already finished would change a completed run's recorded status
over a check that was only ever going to observe it.

## Order, and what stops what

Several hooks may name the same event. They run **in declaration order**, and the first
one to block stops both the operation and the rest of that event's hooks — a later hook's
opinion of an operation that is not going to happen is not worth the wall clock, and
running it anyway would mean a `post-` side effect for a `pre-` event that was refused.

An earlier hook's message still reaches the model alongside the later hook's block: the
block decides what happens, and a model told *why* something was refused deserves whatever
else was being said at the time.

## Configuring it

In the console's [configuration editor](/gg/configurations/), **Hooks** sits beside **Run
limits** above the agents — not inside one, because it belongs to none. Each row picks an
event, a kind, and an optional name, and says under the event picker whether that event
can be blocked at all.

| Field | Meaning |
| --- | --- |
| `event` | One of the ten [events](#the-events). |
| `action` | The tagged union above: `command`, `built-in`, or `custom`. |
| `name` | An operator's label, shown wherever gg reports this hook running or blocking. Optional — gg falls back to describing what it runs. |

A run that declares no hooks behaves exactly as it always has, which is the control arm
every hooked run is read against.
