---
title: "Filesystem tools"
---

The four editor primitives a coding agent works through — `read_file`, `write_file`,
`edit_file`, and `list_dir`. Each is its **own capability**, so a study can withhold or
reconfigure one without disturbing the others:

| Capability | Tool | What it does |
| --- | --- | --- |
| `read-file` | `read_file` | Read a file, under the [read mode](#read-modes) below. |
| `write-file` | `write_file` | Create or overwrite a whole file (parents created). |
| `edit-file` | `edit_file` | Replace one exact, **unique** occurrence of a string. |
| `list-dir` | `list_dir` | List a directory's entries (directories suffixed `/`). |

All four are on in the default capability set, and they appear as their own
**Filesystem** group in the [configuration](/gg/configurations/) editor.

They were originally one `filesystem` capability. That was one toggle, one
implementation, and one params bag shared by four tools — which is precisely the wrong
shape for a harness whose reason for existing is varying one thing at a time. A
capability set saved before the split still names `filesystem`; it is read as enabling
all four (with each tool's default behavior, which is what it had), so nothing needs
migrating and nothing stops launching.

:::note
Splitting them is not the same lever as [toolset ablation](/gg/toolset-ablation/), which
withholds a named tool from a capability that stays on. Turning `edit-file` off and
listing `edit_file` in `disabledTools` withhold the same tool; the capability is the
level at which a tool is *configured*.
:::

Every path these tools accept is workspace-relative and confined to the run's workspace
root: an absolute path, or a `..` that would climb above the root, is refused before any
I/O happens. A run cannot read or clobber files outside the workspace it was seeded
with.

## Read modes

How much of a file **one `read_file` call may return** is the read-file capability's
swappable implementation. Capping reads is one of the load-bearing differences between
real coding harnesses, and which way it cuts is an open question: a cap stops a single
call from flooding the window and forces an agent to be deliberate about what it looks
at, but it also costs a round trip per page and gives the agent room to lose the thread
of a file it only ever half-sees. The three modes are the arms of that experiment.

| Mode | `read_file` returns | The agent can ask for more |
| --- | --- | --- |
| `unlimited` *(default)* | The whole file, one call. | — (there is nothing to page) |
| `hard-cap` | At most `lineCap` lines. | **No** — a larger `limit` is reduced. |
| `default-cap` | `lineCap` lines by default. | **Yes** — a larger `limit` is honored. |

The `lineCap` param sets the cap for both capped modes and defaults to **250** lines. It
is ignored under `unlimited`.

Both capped modes give `read_file` two extra arguments, so the agent can page through a
file it cannot see at once:

- `offset` — the 1-based line to start from (default `1`). An offset past the end of the
  file is an error that names the file's length, rather than an empty result.
- `limit` — how many lines to return. Under `hard-cap` a value above the cap is
  **reduced** to it and the agent is told so, so the ceiling is not something it can
  argue its way past; under `default-cap` a larger value is simply honored.

A windowed result ends with a line saying what the agent is looking at and where to
continue from:

```
[showing lines 251-500 of 1200; continue with offset: 501]
```

Two deliberate properties keep the arms comparable:

- **A file shorter than the cap reads identically under all three modes** — no window
  note, no paging footer. Only files big enough to actually be capped differ between
  arms, so a comparison measures the cap rather than incidental formatting.
- **`unlimited` offers no `offset`/`limit` at all.** Offering knobs that never bind would
  misrepresent the control arm to the model.

A separate 256 KiB **byte** ceiling backstops every mode (a file can have enormous lines),
and applies to whatever the line window selected. A read truncated by it says so.

## What this costs the context window

A `read_file` result enters the window as a `FileView`, tagged with its path — its own
band in the [context breakdown](/gg/context-visibility/), and the thing
[`evict_file_view`](/gg/agent-managed-context/) targets. A capped read puts only the
window it returned into the context, so the two capped modes and the eviction tool are
different answers to the same problem: one rations what enters the window, the other
reclaims it after the fact. They compose, and comparing them is a reasonable study.

Reads are **append-only**, as everything in the window is: a second read of the same file
appends a second view rather than rewriting the first, and re-reading is how an agent
sees a file it has changed. See
[Context visibility](/gg/context-visibility/) for why.
