---
title: "Hooks"
---

A hook is a command or a script gg runs at one of ten points in a run: around a
file write, around a shell command, around a compaction, as an agent starts or
tries to stop, and at the session's two ends. A hook can do two things, and the
same two everywhere. It can block the operation it precedes, and it can put text
in front of the model.

A hook belongs to the operator rather than to the model. The model is told
nothing about a hook, is offered no tool for one, and cannot decline one; a
blocked write reaches it as a refusal from the harness. Hooks are not
capabilities and never appear in the `cap.*`
[query](/gg/analysis/query-language/) namespace.

## Where a hook is declared

A hook's event decides which of two lists it belongs to.

- The two session events (`session-start`, `session-end`) fire once per run,
  around the root's session as a whole. They are declared on the capability set
  itself, beside the [execution ceilings](/gg/execution-limits/).
- The other eight fire because a particular agent wrote a file, ran a command,
  filled its window, started or tried to stop. They are declared on that agent.

The agent half is per profile because the agents of a run are held to different
gates. "The build must pass before you may stop" is right for an implementer and
wrong for a reviewer whose job is to report that the build fails. Declared once
for the run, such a gate would fire for every agent, and each script would have
to work out from the agent identity in its payload whether it was meant to fire
at all.

A hook declared in the other list's place fails the launch, naming the move that
fixes it. So does a `built-in` hook whose script id gg does not ship, with the
error naming the ids that exist.

```jsonc
{
  // The run's own two ends.
  "hooks": [
    {
      "event": "session-end",
      "name": "report",
      "action": { "type": "command", "command": "./notify.sh" }
    }
  ],
  "agents": [
    {
      "name": "Implementer",
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
    },
    {
      "name": "Reviewer",
      "hooks": []
    }
  ]
}
```

## The events

Ten events: four `pre`/`post` pairs and the session's two ends. A `pre-` event
runs before its operation and is the only kind that can stop it; a `post-` event
runs after and can only add to what the model is told.

| Event | Fires | Can block | Can insert | Payload beyond the [agent facts](#the-event-payload) |
| --- | --- | --- | --- | --- |
| `pre-write` | Before a file write | yes | yes | `path` (absolute), `contents` |
| `post-write` | After the file is updated | no | yes | `path`, `contents`, `ok` |
| `pre-shell` | Before a shell command runs | yes | yes | `command` |
| `post-shell` | After it has run | no | yes | `command`, `ok` |
| `pre-compact` | Before a [compaction](/gg/compaction/) | no | no | `strategy` |
| `post-compact` | After the window is rewritten | no | yes | `strategy` |
| `agent-start` | When an agent instance starts | no | yes | — |
| `agent-stop` | When an agent tries to end | yes | yes | `call` |
| `session-start` | Once, before the root's first turn | no | yes | — |
| `session-end` | Once, after the root finishes | no | no | `status` |

Two rows depart from what the `pre`/`post` prefix suggests, so both are stated
rather than implied.

- `pre-compact` is a `pre-` event that cannot block. Compaction happens because
  the window is full, so the only useful thing a hook can do there is observe.
  It cannot insert either: the window it would insert into is the one being
  rewritten.
- `session-end` cannot insert. It fires after the last turn anybody could read
  it on. It is where a run reports on itself.

A hook that blocks a non-blocking event, or returns a message on an event with
no prompt to insert into, is reported to the operator as a misconfiguration and
is not honored.

A `pre-write` payload carries the contents the file will end up with rather than
the patch that gets it there, so an `edit_file` is shown to a hook the way a
`write_file` is. A `post-compact` insertion is pinned into the rebuilt window,
which is the one moment a run can put back something a compaction dropped; every
other insertion is ephemeral.

### The event payload

Whatever the event, the JSON a script is handed carries who it is firing for:

```jsonc
{
  "event": "pre-write",
  "agentId": "agent-3",          // the instance's id, its handle in the tree
  "agent": "Implementer",        // the agent PROFILE's name
  // one of: root, issue-implementer, issue-reviewer, subagent
  "agentKind": "issue-implementer",
  "worktree": { "branch": "gg/issue-1", "path": "/w/issue-1" },  // or null
  "path": "/w/issue-1/src/main.rs",  // the event's own fields, beside the agent's
  "contents": "…"
}
```

Knowing the profile is not knowing the instance. A profile can be running a
dozen times at once, so a script asked to decide about a write needs `agentId`
to tell which of them is writing, and `worktree` to tell whether that instance
works in an [isolated tree](/gg/project-management/) where the path it is shown
means something different from the same path in the main tree. `path` is
absolute for the same reason.

`agentKind` is the role the instance was dispatched in, not its profile: the
same profile implements an issue in one dispatch and reviews one in the next.

### `agent-stop`

The ending gate. A blocking hook here hands its reason back to the model and the
session continues, so the model fixes the problem and declares it is done again.
It applies to every agent that declares an
[ending](/gg/ending-a-session/) and in both execution modes.

A run that can never satisfy the gate goes on taking turns until it trips a
[ceiling](/gg/execution-limits/), which is a diagnosis rather than a silence.

## The three kinds

### Command

Run a command line, exactly as the [shell tool](/gg/shell/) runs one. It
receives no input, on the reasoning that the checks that are already commands
(`npm test`, `cargo clippy`) read the workspace rather than being told about it.
A hook that needs to know what is being written wants a [script](#custom).

A command that exits zero and printed something inserts its output. A non-zero
exit blocks, and the reason the model reads carries that same output. Output
goes through the agent's own [offloading policy](/gg/shell/), so a failing test
suite that prints a megabyte behaves the way a megabyte of `shell` output does.

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

Run one of gg's own hook scripts by id. A built-in follows the
[custom](#custom) contract in every respect, with the source coming from gg
instead of the configuration. Each is a worked example to read, copy into a
custom hook, and change.

| Id | What it does |
| --- | --- |
| `trace` | Report every event it receives back as a message, and continue. The first hook to reach for, because "does this event fire, and with what?" is the question every other hook starts from. |
| `refuse-empty-write` | Block a write whose contents are empty or whitespace, on the reasoning that a model which truncates a file to nothing has lost it rather than meant to empty it. Every other write, and every non-write event, passes. |
| `guard-destructive-shell` | Block a shell command that would `git push`, `git reset --hard`, or recursively remove a path outside the workspace. A guard rail rather than a sandbox: it matches on the command text. |

### Custom

Run a script the configuration carries verbatim. gg writes it under `.gg/hooks/`
in the run's workspace, in a subdirectory of its own declaration site, makes it
executable, and runs it with the event payload as its sole argument. The
argument is a JSON string rather than a stream, so a script reads its input
without a parser for the reading. A leading `#!` line chooses the interpreter; a
script without one is run by `sh`.

The script must exit `0` and print one decision object on stdout:

```jsonc
{"action": "continue"}
{"action": "block", "reason": "why the operation was refused"}
{"action": "message", "message": "text put in front of the model"}
```

The three outcomes are exclusive, so the decision is a tagged union rather than
a bag of optional fields. A `block` carrying a `message` beside it would leave
gg guessing whether the message was the reason for the block or an insertion the
author also wanted.

Only the last non-empty line is parsed, so a script that logged its way to a
decision is read the way it was written.

```sh
#!/bin/sh
# Refuse a write to anything under `vendor/`.
python3 - "$1" <<'PY'
import json, sys
event = json.loads(sys.argv[1])
path = event.get("path", "")
if "/vendor/" in path:
    reason = f"{path} is vendored; do not edit it."
    print(json.dumps({"action": "block", "reason": reason}))
else:
    print(json.dumps({"action": "continue"}))
PY
```

## Hook failures

A script that exits non-zero, or prints something gg cannot parse, has judged
nothing. Letting the operation through would claim it passed; blocking it would
claim it failed. gg does neither: it stops the run, with the script's own output
on the operator stream and a terminal status of `hook_error`.

This is the one place in gg where a misbehaving subprocess is fatal rather than
fed back to the model. The model never asked for the hook, so there is nobody to
hand the question to. A command hook's non-zero exit is different in kind: the
check ran and returned a verdict.

The exception is `session-end`, whose failure is logged and otherwise ignored.
Stopping a run that has already finished would change a completed run's recorded
status over a check that was only ever going to observe it.

## Ordering

Several hooks may name the same event. They run in declaration order, and the
first one to block stops both the operation and the rest of that event's hooks.
An earlier hook's message still reaches the model alongside the later hook's
block: the block decides what happens, and a model told why something was
refused reads whatever else was being said at the time.

## Configuring it

In the console's [configuration editor](/gg/configurations/), the two session
events are declared under Session hooks on the Configuration tab, and an
agent's eight are declared on that agent's Hooks tab. Each list offers only the
events its site can hold. Each row picks an event, a kind, and an optional
name, and says under the event picker whether that event can be blocked.

| Field | Meaning |
| --- | --- |
| `event` | One of the ten [events](#the-events). |
| `action` | The tagged union above: `command`, `built-in`, or `custom`. |
| `name` | An operator's label, shown wherever gg reports this hook running or blocking. Optional: gg falls back to describing what it runs. |
