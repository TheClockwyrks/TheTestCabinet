---
title: "Shell commands"
---

One `shell` event rides on the stream per command line gg ran on an agent's
behalf, emitted on the stream of the agent it ran for. All three of gg's
command paths emit it: the [`shell` tool](/gg/shell/), a
[responses-as-code](/gg/responses-as-code/overview/) program's
`gg.shell.shell(…)`, and a [hook](/gg/hooks/)'s commands. The event's `origin`
names which, so a command gg ran without the model asking stays distinguishable
from one the model issued.

## What the event carries

| Field                             | What it carries                                                                                                                         |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `origin`                          | Which command path issued it: `tool`, `program`, or `hook`.                                                                             |
| `command`                         | The command line, as handed to `sh -c`.                                                                                                 |
| `cwd`                             | Where it ran, expressed relative to the agent's own workspace root: the root itself, a path beneath it, or an absolute path outside it. |
| `exitCode`                        | The exit status. A timeout kill, a signal-terminated process, and a process that never launched all pin as `-1`.                        |
| `stdout` / `stderr`               | The trailing 16,384 characters of each stream.                                                                                          |
| `stdoutDropped` / `stderrDropped` | How many leading characters the cap removed from each stream. Omitted when zero.                                                        |

The streams are the process's own, captured before the shell capability's
[output policy](/gg/shell/#output-offloading) merged and truncated them for the
model. The exit-code pinning and the workspace-relative directory follow the
[session record](/gg/session-record/)'s shell entries, which hold every
command's full streams; this event is the live, capped view of the same fact.

## The console's Shell file

The event backs the `shell` file in the Instances explorer, described under
[console surfaces](/gg/telemetry/console/#the-shell-file). The file is offered
per agent, gated on that agent's profile enabling the
[shell capability](/gg/shell/).
