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

## Reading images

A test case's specs ship **reference mockups**, so `read_file` on a `.png` has to do
something better than hand the model a screenful of mojibake — which is exactly what
decoding image bytes as lossy UTF-8 produces. It reads the picture as a picture:

- **The format is detected by magic number, not by extension.** The tool already has the
  bytes, and an extension is a claim rather than a fact — a mockup saved as `.txt` is
  still an image, and a `.png` holding text is still text. PNG, JPEG, GIF, and WebP are
  recognized; anything else reads as the ordinary file it is.
- **The image is attached to its own tool result**, alongside a line of prose naming the
  file, format, and size. It travels to the provider as a base64 `data:` URL in a
  multi-part message.
- **`offset`/`limit` do not apply.** They describe lines of text; a picture is returned
  whole or not at all.
- **An image over 8 MiB is described rather than attached.** An inline image is charged to
  the window at a rate no estimator can pin down, so an unbounded one is the easiest way
  for a run to spend its whole context on a single call. Every reference mockup a test
  case ships clears the limit by a wide margin.

### Models that cannot see images

The models a study sweeps are not uniform: some accept image input and some are
text-only, and a text-only model answers an image-bearing request with a hard error.
**Reading a reference image must never be what discards a run**, so gg resolves this in
two stages.

**Declared, up front.** The [model catalog](/components/backend/) records the input
modalities OpenRouter reports per model, and the launch pushes them into the run
alongside each model's [context window](/gg/configurations/#model-slots). A model declared *without*
`image` is simply never sent one: `read_file` describes the file instead of attaching it,
the system prompt tells the model up front that it cannot see images and that re-reading
will not change that, and no request is wasted.

**Learned, at runtime.** A model the catalog has no modality list for is treated
**optimistically** — unknown is not the same as text-only, and withholding a test case's
mockups from a just-released model would be the wrong default for a harness whose point
is running new models. If the provider then refuses the request (OpenRouter answers
`No endpoints found that support image input`), gg:

1. records the model as unable to see images, **run-wide** — shared across agents, so
   every subagent bound to the same model stops attaching them too;
2. strips the images from the context, keeping each affected tool result's text *and* its
   `tool_call_id` — so every assistant tool call still has its matching result and the
   conversation stays well-formed — plus a note telling the model where the picture went;
3. re-runs the same turn against the now image-free conversation.

Being wrong therefore costs one request per model per run, not the run. A model's vision
support is shown on its page in the console's **Models** section, under **Specs**.

## What this costs the context window

A `read_file` result enters the window as a `FileView`, tagged with its path — its own
band in the [context breakdown](/gg/context-visibility/), and the thing
[`evict_file_view`](/gg/agent-managed-context/) targets. An attached image is part of the
same view, so evicting the view reclaims the picture too. Its cost is **estimated**: every
provider charges images by its own tiling of the decoded dimensions, which gg does not
decode, so the figure is a deliberately coarse stand-in whose job is only to stop an
attached mockup being accounted as free (which would let fullness drift below the truth
and delay compaction, precisely on the runs that read the most reference material). A capped read puts only the
window it returned into the context, so the two capped modes and the eviction tool are
different answers to the same problem: one rations what enters the window, the other
reclaims it after the fact. They compose, and comparing them is a reasonable study.

Under [responses as code](/gg/responses-as-code/) the same read costs the window **nothing**:
`fs.readFile` hands the bytes to the program and stops there. What puts a file in the window
is `view.openFile(path)`, which does the identical read — same line cap, same magic-number
image detection, same 8 MiB ceiling — and *also* opens a file view of it, keyed by the path
and closable by it. The picture comes with it, so a program that opens a view of a reference
mockup shows the model the mockup rather than only describing it. The split is the point, and
the prompt teaches it in one line: `fs.readFile` gets bytes for your program;
`view.openFile` shows a file to you.

Reads are **append-only**, as everything in the window is: a second read of the same file
appends a second view rather than rewriting the first, and re-reading is how an agent
sees a file it has changed. See
[Context visibility](/gg/context-visibility/) for why.
