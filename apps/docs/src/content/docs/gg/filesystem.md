---
title: "Filesystem tools"
---

The four editor primitives a coding agent works through, and the search that
finds where to point them. Each is its own capability, so a study can withhold
or reconfigure one without disturbing the others.

| Capability | Tool | What it does |
| --- | --- | --- |
| `read-file` | `read_file` | Read a file, under the [read mode](#read-modes) below. |
| `write-file` | `write_file` | Create or overwrite a whole file (parents created). |
| `edit-file` | `edit_file` | Replace one exact, unique occurrence of a string. |
| `list-dir` | `list_dir` | List a directory's entries (directories suffixed `/`). |
| `search` | `search` | Content search over the workspace, under the ignore rule in [searching](#searching) below. |

All five are enabled in a fresh configuration, and they appear as their own
Filesystem group in the [configuration](/gg/configurations/) editor.

`edit_file` replaces exactly one occurrence. Text that is absent and text that
occurs several times are distinct failures with distinct recoveries: the first
has to be re-read, the second disambiguated.

:::note
The capability is the level at which a call is configured. An agent's
[allowlist](/gg/configurations/#granting-calls) is the separate lever that
decides which of an enabled capability's calls that agent is given.
:::

## Paths

A path these tools accept is resolved the way any process in the container
resolves one: a relative path against gg's working directory, and an absolute
path as itself. The working directory is the run's workspace root, or the
agent's own [worktree](/gg/project-management/) when it has one. `..` is
ordinary and is left for the kernel to resolve. The one refusal is an empty
path, which joined onto the working directory would name that directory itself.

The container is the boundary, so these tools reach anything in it. gg's own
shell [offloads](/gg/shell/#output-offloading) command output to `/tmp/gg-shell`
and tells the agent to read it there, which a workspace-confined `read_file`
could not honor.

## Searching

The `search` capability's one tool scans the workspace's files for a query and
returns the matching lines, each with its path and 1-based line number. Under
[responses as code](/gg/responses-as-code/overview/) the same operation is
`gg.files.search`, and an agent that holds it has its documentation opened by
[the opening turn](/gg/responses-as-code/views/#the-opening-turn), before the
model's first turn.

The query is a **regular expression** (Rust syntax — `foo|bar`, `fn\s+update`,
`(?i)todo` for a case-insensitive match), tried against each line on its own;
a blank query and an invalid pattern are both argument errors. `path` roots the
search at one directory or one file — absent, the workspace root — and a path
that does not exist is `not-found`. Matches arrive in path order and then line
order, each as the path, the 1-based line number and the line without its
ending.

The result is bounded so one search cannot flood a turn. `limit` says how many
matches come back — 50 when it is left out, and never more than 200, so a larger
request is answered with the first 200 — and a list exactly `limit` long may have
been cut; there is no offset, because a search is a question about where to
point the other tools rather than a way of reading a file, so the answer to a
cut list is a narrower query or path. A matching line longer than 200 characters
is cut there and annotated in place as `foo (123 more chars...)`, and a file that
is not text (one carrying a NUL byte) is skipped rather than matched byte by
byte.

The search honors ignore files: what `.gitignore`, `.ignore` and their kin
exclude — nested files, negations and `.git/info/exclude` included, and `.git`
itself — is never scanned and never returned, in a workspace that is a
repository and in one that is not yet. Dotfiles are otherwise searched like any
other file. A match list therefore holds the agent's sources rather than
`node_modules`, build output and the run's own bookkeeping, and a file under an
ignored path is still reachable by path through every other tool on this page.
Ignoring is the search's own rule, because a search is a question about the
project rather than about the disk.

## Read modes

How much of a file one `read_file` call returns is the read-file capability's
swappable implementation, and an enabled read-file capability names one. Capping
reads is one of the load-bearing differences between real coding harnesses: a cap
stops a single call from flooding the window and forces an agent to be deliberate
about what it looks at, while costing a round trip per page. The two modes are
the arms of that experiment.

| Mode | A call that names no `limit` returns |
| --- | --- |
| `unlimited` | The rest of the file, from `offset` to its end. |
| `default-cap` | `lineCap` lines, from `offset`. |

Both modes take `offset` and `limit` and honor them whenever they are given.
The mode decides only what a call that names no `limit` gets.

The `lineCap` param sets the window a call gets when it asks for no `limit` of
its own. The capability writes it whichever mode is selected, so a sweep that
varies the mode over one shared params block reads the same figure on both arms
and every launch in the sweep is judged the same way. An absent `lineCap`, a
value gg cannot read as a line count of one or more, and an implementation gg
does not recognize each refuse the launch, the last of them naming the two
modes. A refusal names every value in the configuration gg cannot honour exactly
as written, so one pass fixes them all.

`read_file` takes two paging arguments under either mode, so the agent can page
through a file it did not get at once:

- `offset` — the 1-based line to start from, defaulting to `1` under either
  mode. An offset past the end of the file is an error naming the file's
  length.
- `limit` — how many lines to return. A value that is given is always honored,
  verbatim, under either mode; under `default-cap` a larger value than the cap
  is how the agent talks past it.

A windowed result — one that starts after line 1 or stops short of the file's
end, whichever mode and whichever arguments produced it — ends with a line
saying what the agent is looking at and where to continue from:

```
[showing lines 251-500 of 1200; continue with offset: 501]
```

A result that ran to the end of the file from an `offset` past line 1 still
says which lines it shows, without a continuation.

### Whole-file reads under either mode

The cap bounds a call that asked for nothing rather than every call. An agent
that asks for a `limit`
covering the file gets the file, byte for byte, exactly as `unlimited` would
have returned it, with no window note appended.

That is a property gg depends on.
[Autoload specifications](/gg/autoload-specifications/) seeds a case's
specifications whole into an agent's opening context, and it reads them through
this same tool.

Two further properties keep the arms comparable:

- A file shorter than the cap reads identically under both modes, with no window
  note and no paging footer. Only files big enough to be capped differ between
  arms, so a comparison measures the cap rather than incidental formatting.
- The tool's schema offers `offset` and `limit` under both modes and states on
  `limit` what leaving it out means: the cap under `default-cap`, the end of
  the file under `unlimited`. The tool-calling [system prompt](/gg/prompts/)
  states the cap only under `default-cap`, with this run's own `lineCap`
  interpolated. Under [responses as code](/gg/responses-as-code/overview/) no
  prompt states it: the paging footer above carries the file's length and
  where to continue from, on the read that was actually windowed.

A separate 256 KiB byte ceiling backstops every mode, since a file can have
enormous lines, and applies to whatever the line window selected. A read
truncated by it says so.

## Reading images

A test case's specs ship reference mockups, so `read_file` on a `.png` reads the
picture as a picture.

- The format is detected by magic number rather than by extension. PNG, JPEG,
  GIF, and WebP are recognized; anything else reads as the ordinary file it is.
- The image is attached to its own tool result, alongside a line of prose naming
  the file, format, and size. It travels to the provider as a base64 `data:` URL
  in a multi-part message.
- `offset` and `limit` describe lines of text, so a picture is returned whole.
- An image over 8 MiB is described rather than attached. An inline image is
  charged to the window at a rate no estimator can pin down, and every reference
  mockup a test case ships clears the limit by a wide margin.

Those four describe the `read_file` tool. Under responses as code the detection,
the ceiling and the vision handling are identical, and the attaching differs.
See [what this costs the context window](#what-this-costs-the-context-window).

### Models that cannot see images

The models a study sweeps are not uniform: some accept image input and some are
text-only, and a text-only model answers an image-bearing request with a hard
error. Reading a reference image must never be what discards a run, so gg
resolves this in two stages.

The declared stage reads the model catalog, which records the input modalities
OpenRouter reports per model, and the launch pushes them into the run alongside
each model's [context window](/gg/configurations/). A model declared without
`image` is never sent one: `read_file` describes the file instead of attaching
it, and both [system prompts](/gg/prompts/) state up front that reading images is
unsupported, on a run that offers `read_file`. The tool-calling prompt carries
that line in its Reading Files section; the code prompt carries the line by
itself, under its Views heading.

The learned stage covers what the catalog does not. A model with no modality
list is treated optimistically, since unknown is distinct from text-only and a
harness whose point is running new models should show them a test case's
mockups. If the provider then refuses the request, gg:

1. records the model as unable to see images, run-wide, so every agent bound to
   that model stops attaching them too;
2. strips the images from the context, keeping each affected tool result's text
   and its `tool_call_id` so every assistant tool call still has its matching
   result, plus a note telling the model where the picture went;
3. re-runs the same turn against the now image-free conversation.

Being wrong therefore costs one request per model per run. A model's vision
support is shown on its page in the console's Models section, under Specs.

## What this costs the context window

A `read_file` result enters the window as a `FileView` tagged with its path. It
is its own band in the [context breakdown](/gg/context-visibility/) and the
thing [`gg.context.evictFileView`](/gg/agent-managed-context/) targets. An
attached image is part of the same view, so evicting the view reclaims the
picture too.

An image's cost is estimated from its dimensions. gg reads the width and height
out of the image header and charges the tile count a picture of that size costs,
so an attached mockup weighs close to what the provider bills for it. Providers
tile differently and a header gg cannot read falls back to a charge derived from
the file's size, so the figure remains an estimate. A
capped read puts only the window it returned into the context, so `default-cap`
and eviction are two answers to the same problem: one rations what enters the
window, the other reclaims it afterwards. They compose.

Under [responses as code](/gg/responses-as-code/overview/) the same read costs
the window nothing: `gg.files.readFile` hands the bytes to the program and stops
there. What puts a file in the window is `gg.views.openFile(path)`. It performs
the identical read, under the same line cap, the same magic-number detection and
the same 8 MiB ceiling, and it also opens a file view of the result, keyed by the
path and closable by it. What one view may carry is bounded by the
[view caps](/gg/responses-as-code/views/#caps), which refuse an over-cap window
rather than truncating it. `gg.files.readFile` gets bytes for your program;
`gg.views.openFile` shows a file to you.

A picture obeys that split. Under the code arm `gg.files.readFile` of a mockup
returns the descriptor (label, format, byte size) and detects the format the
same way, with `shown: false` and a reason naming `gg.views.openFile` as the way
to look at it. A view is the only channel into a code agent's window. A program
that means to look at a reference mockup opens a view of it; one that wants only
its dimensions or its bytes pays nothing. How many such views may be open at
once is unbounded: what bounds a picture is its own 8 MiB ceiling, and
re-opening a path takes the image out of the copy it retires, so what a run
uploads per request follows what is open.

Reads are append-only, as everything in the window is. A second read of the same
file appends a second view rather than rewriting the first, and re-reading is
how an agent sees a file it has changed. See
[Context visibility](/gg/context-visibility/).
