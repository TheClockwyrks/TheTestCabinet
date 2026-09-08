---
title: "Shell"
---

The `shell` capability contributes one tool, `shell`, which runs a command line
through `sh -c` in the run's workspace and returns the merged stdout and stderr
with the exit code. It is enabled in a fresh configuration, and it appears
in the Models & tools group of the [configuration](/gg/configurations/) editor.

## Running a command

A command runs with its working directory set to the workspace root, or to the
agent's own worktree when it has one. It runs in its own process group, so a
timeout kill reaches the whole tree rather than `sh` alone, under a per-call
timeout of 120 seconds, which the caller may raise or lower per call.

A non-zero exit is a result rather than a failed call. The exit code and the
output both come back so the agent can branch on them, because deciding whether
a build or a test run passed is the most common thing an agent does with this
tool. Two conditions fail the call itself: a process that could not be launched,
and one the timeout killed.

Under [responses as code](/gg/responses-as-code/overview/) a program calls
`gg.shell.shell(command, { timeoutSecs })` and is handed back the `exitCode`, the
merged `output`, and whether that output was `truncated`. A call naming no
`timeoutSecs` runs under the 120-second call timeout; one that is not a positive
number of seconds is an `invalid-argument` refusal, the same answer the tool
surface gives. The
requested timeout is clamped to 24 hours and then to whatever is left of the
run's wall-clock budget, since a host call cannot be cut short once it is in
flight. What the call does is carried by the function's own one-line brief, which
the [opening turn](/gg/responses-as-code/views/#the-opening-turn)'s search puts
in front of an agent whose opening turn lists the `shell` module, as the default
does.

## Output offloading

How much of a command's output comes back inline is the shell capability's
swappable implementation. A chatty command can spend a large fraction of a
context window in a single call, so the amount that returns inline is a
configurable arm rather than a fixed behavior.

| Mode      | Returned inline                        | On disk |
| --------- | -------------------------------------- | ------- |
| `offload` | The tail, plus a note naming the files | Both    |
| `inline`  | The whole output, capped at 16 KiB     | Nothing |

The tail is the last `maxLines` lines and/or `maxChars` characters, described
under [the two ceilings](#the-two-ceilings) below.

Under `offload` each command's two streams are written to their own file under
`/tmp/gg-shell`, outside the workspace so a run's diff holds the agent's work
rather than gg's bookkeeping. The pair is written for every command, so "the
full output is on disk" holds unconditionally and an agent never re-runs a
command to find out whether its log exists. Those paths are absolute, and the
[filesystem](/gg/filesystem/) calls read them, so an agent that wants the whole
of a command's output opens the file rather than running the command again.

### The two ceilings

An enabled shell capability writes both ceilings, whichever mode it selects:

- `maxLines` — the most trailing lines that come back inline. A trailing newline
  terminates the last line rather than starting a new one, so the count matches
  what `tail -n` reports.
- `maxChars` — the most trailing characters that come back inline. Characters
  rather than bytes, so a ceiling means the same thing whatever the output is
  written in.

The tighter of the two decides, because the result has to satisfy both. gg's
16 KiB byte cap applies behind them under every mode.

A missing ceiling, a ceiling gg cannot read as a count, and a mode gg does not
recognize each refuse the launch, the last of them naming the modes gg does
recognize. The refusal names every value in the configuration gg cannot honour
exactly as written, so one pass fixes them all.

### The truncation note

Output that fits under the ceilings comes back untouched and carries no note, so
a two-line command costs no context for a feature it did not need. Output that
does not is followed by:

```
[Output truncated: last 200 lines]
stdout: /tmp/gg-shell/cmd-41-0003.stdout
  4812 lines; line length p50 74, p95 210, p99 1043
  longest lines: 8301 chars @ 3117, 6114 @ 2988, 5902 @ 41, 4344 @ 42, 3011 @ 799
stderr: /tmp/gg-shell/cmd-41-0003.stderr
  12 lines; line length p50 38, p95 71, p99 80
  longest lines: 80 chars @ 4, 71 @ 9, 68 @ 5, 55 @ 1, 52 @ 12
```

When gg's 16 KiB byte cap cut the tail further, the first line says so as well:
`[Output truncated: last 200 lines, capped at 16384 bytes]`.

Beneath each path the note states the shape of the file it names: its total
line count, its 50th/95th/99th-percentile line lengths, and the length and line
number of its five longest lines. The tail says what happened last; the shape
says where the bulk sits and which lines are pathological, so a model aims a
windowed `read_file` or a `gg.views.openFile` window at the right region of a
file it has never seen rather than paging from the top. Line lengths count
characters, line numbers are 1-based, a tie between equally long lines goes to
the earlier one, and a stream that printed nothing is described by its line
count alone (`0 lines`).

The note is part of the command's output rather than prose gg wraps around it,
so a program that opens a view on `ShellOutput.output` puts the paths in front
of the model exactly as a tool-calling agent sees them. The `shell` tool's own
description states the rule as well, so a model meets it before its first
truncated build log rather than in one, and greps the file it was handed instead
of re-running the command with a narrower filter.

### Where the policy applies

One function applies the policy, so a JSON tool call and a program's
`gg.shell.shell(…)` are governed identically. gg's [hook](/gg/hooks/) runner
reaches the same function: a command hook's output is offloaded on the agent's
policy unless that hook names its own `output` mode. That mode is read from the
same vocabulary and refuses the launch on the same terms. A script hook's stdout
is its verdict and is always read whole.

The policy is read only from an enabled `shell` capability. An agent that holds
no shell has no policy to apply, so hook output reaching this function comes back
whole, under the byte cap alone.

### Example

```json
{
  "id": "shell",
  "enabled": true,
  "implementation": "offload",
  "params": { "maxLines": 200, "maxChars": 8000 }
}
```
