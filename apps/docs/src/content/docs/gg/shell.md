---
title: "Shell"
---

The `shell` capability offers the one tool an agent builds a project with: `shell`, which
runs a command line through `sh -c` in the run's workspace and hands back the merged
stdout and stderr with the exit code. It is on in the default capability set, and it
appears in the **Models & tools** group of the
[configuration](/gg/configurations/) editor.

Every command runs with its working directory set to the workspace root, in its own
process group, under a per-call timeout that defaults to **120 seconds** and is clamped to
whatever is left of the run's wall-clock budget. A **non-zero exit is a result, not a failed call**:
the code and the output come back so the agent can branch on them, because checking
whether a build or a test run passed is the single most common thing an agent does with
this tool.

## Output offloading

How much of a command's output comes back **inline** is the shell capability's swappable
implementation. A chatty command is one of the few things an agent does that can spend a
large fraction of its context window in a single call, on text it usually needed three
lines of — a failing test suite, a webpack build, a `find` across `node_modules`. Whether
capping that helps or hurts is exactly the kind of question gg exists to answer, so it is
a mode rather than a fixed behavior.

| Mode | `shell` returns | Written to disk |
| --- | --- | --- |
| `adaptive` *(default)* | For a command that **succeeded**: its exit code and the paths, nothing else. For one that **failed**: the same tail `offload` returns. | **Every** command's stdout and stderr, as a file pair. |
| `offload` | Only the last `maxLines` lines and/or `maxChars` characters, plus a note naming the files. | **Every** command's stdout and stderr, as a file pair. |
| `inline` | The whole merged output, tail-truncated at gg's 16 KiB cap. | Nothing. |

Under either truncating mode, each command's two streams are written to their own file
under `/tmp/gg-shell` — outside the workspace, because these are gg's bookkeeping and a
run's diff should not fill up with build logs. The pair is written for *every* command, not
only a chatty one: "the full output is on disk" is only useful if it is true
unconditionally, since an agent that has to guess whether this command's log exists is back
to re-running the command to find out.

### Adaptive: the default

`adaptive` splits the decision on the one signal that predicts whether the output will be
read — the exit code. A successful command's output is the bulk of what a run's shell calls
produce and the part an agent least often needs: `cargo build` printing forty lines of
`Compiling` says nothing the exit code did not. A failed command is the opposite. So a
success comes back as

```
exit code: 0
[The command succeeded, so its output is not shown. The full stdout and stderr were written to:
  stdout: /tmp/gg-shell/cmd-41-0003.stdout
  stderr: /tmp/gg-shell/cmd-41-0003.stderr
Read or grep those files if you need them.]
```

and a failure comes back exactly as it would under `offload`. A command that printed
nothing and succeeded reads `(no output)` — there is nothing worth pointing at. A command
killed by its timeout did not succeed, so its partial output is *not* withheld.

The output is withheld, never discarded: if gg cannot write the file pair there is nowhere
to withhold it *to*, so the whole output is handed over instead (with a note saying why the
promised files are missing).

### The two ceilings

Both truncating modes read them, and honor both when both are set:

- **`maxLines`** — the most trailing lines that come back inline. A trailing newline
  terminates the last line rather than starting a new one, so the count matches what
  `tail -n` would report.
- **`maxChars`** — the most trailing *characters* (not bytes, so a ceiling means the same
  thing whatever the output is written in).

With both set the **tighter** one decides, because the result has to satisfy both. gg's
16 KiB byte cap still applies behind them, so a `maxLines` generous enough to admit a
megabyte cannot defeat the thing offloading is for.

Either ceiling alone is a complete instruction, and leaves the axis it omits uncapped. A
mode that names **neither** takes gg's defaults — **250 lines and 4096 characters** — rather
than quietly becoming `inline` under another name.

A mode gg does not recognize is a misconfiguration rather than an instruction: it runs as
`adaptive`, and gg logs a warning on the root agent's stream before the first turn. Nothing
fails the launch — a sweep's one shared configuration document has to stay interpretable by
every arm — but the warning is what stops one arm from quietly wearing another's name.

### What the agent sees

Output that fits under the ceiling comes back untouched, with no note: a two-line command
costs no context for a feature it did not need. Output that does not is followed by:

```
[Output truncated: showing the last 200 lines. The full stdout and stderr of this command
were written to:
  stdout: /tmp/gg-shell/cmd-41-0003.stdout
  stderr: /tmp/gg-shell/cmd-41-0003.stderr
Read or grep those files if you need more than what is shown above.]
```

The note is part of the command's **output** rather than prose gg wraps around it, so a
[responses-as-code](/gg/responses-as-code/) program that prints a `ShellOutput.output` sees
the paths exactly as a tool-calling agent does. The `shell` tool's own description states
the rule up front as well, because a model that first meets it in a truncated build log
will assume the missing output is *gone* and re-run the command with a narrower filter,
rather than grepping the file it was just handed.

If gg cannot write the pair (a full disk, an unwritable `/tmp`), it does **not** truncate
to a tail whose remainder now exists nowhere: it falls back to the inline behavior, and the
note says why the promised files are missing.

### Where it applies

The policy is applied in the one function both execution modes reach, so it governs a JSON
tool call and a program's `system.shell(…)` identically, and it also covers the
[completion validation](/gg/configurations/) commands gg runs on the agent's behalf — a
failing test suite is exactly the kind of output that arrives by the megabyte.

It is read only from a capability that is **enabled**; an absent or disabled one resolves
to `inline`. Offloading is a bargain — you see less of the output, and you get the rest back
by grepping — and an agent that was not offered the `shell` tool cannot hold up its end.

### Example

```json
{
  "id": "shell",
  "enabled": true,
  "implementation": "offload",
  "params": { "maxLines": 200, "maxChars": 8000 }
}
```
