---
title: Authoring an Audio Test Case
---

An **audio** [asset-generation](/testing/asset-generation/overview/#audio) test
case asks a model to **author one short game-audio clip** — a sound effect or a
snatch of music — through an **audio binary**, one recorded operation at a time,
to **match a written brief**. Like every asset-generation case there is **no
target clip**: the model is given a precise description of the sound and the
freedom to build something that matches it, so the case rewards sound-design
reasoning rather than the faithful reproduction of a supplied recording. It plays
out entirely in the ear of a reviewer — the model cannot hear its own output, so
the binary renders a **waveform + spectrogram** (and, for music, a **piano-roll**)
it reads to see its progress. Authoring a case is mostly writing a precise,
**self-contained brief**.

[Manifests](/testing/asset-generation/manifests/#audio-cases) is the authoritative
schema for the `[audio]` table and its rules; the [Audio
binaries](/testing/asset-generation/audio-binaries/) page documents exactly how
each tool behaves (the modular synth graph, the sample-library mixer, the
note-sequencer over an instrument bank); the
[Overview](/testing/asset-generation/overview/#audio) says why the recorded
actions — not the `.wav` on disk — are the output; and
[Evaluation](/testing/asset-generation/evaluation/#audio-validation) covers how a
clip is validated and reviewed. Read those first. This guide is self-contained;
you do not need anything beyond the pages it links.

Drawing a 2D sprite, sculpting a 3D voxel or mesh, or building a playable game are
different kinds (or a different test type) with their own manifests; see
[Authoring an Asset-Generation Test Case](/guides/authoring/authoring-an-asset-generation-test-case/)
and [Authoring an End-to-End Test Case](/guides/authoring/authoring-an-end-to-end-test-case/).

A case is exactly **one of three kinds**, chosen by the manifest's `asset_kind` —
a version-level choice, not a variant axis:

- **`sfx-synth`** — synthesize a sound effect from a **modular synth graph** alone
  (oscillators, noise, envelopes, filters, FM). It names **no** sample pack or
  bank: the sound is built from nothing but DSP. The worked example is
  **`spectra-laser`** (a synthesized laser-fire blip).
- **`sfx-sample`** — layer a sound effect **over a baked sample library**, the
  game-audio-DAW tier: select, layer, time, pitch, and process recorded library
  clips (with synth voices for glue). It names a **`sample_pack = "name@version"`**.
  The worked example is **`thunderhead-broadside`** (a layered naval-cannon report
  over the `combat-core` pack).
- **`music`** — sequence a short piece as **notes on instrument tracks** over a
  baked instrument bank, and emit a portable `.mid` beside the `.wav`. It names an
  **`instrument_bank = "name@version"`**. The worked example is
  **`thunderhead-theme`** (a short military battle theme over the `gm-lite` bank).

Read the worked example matching the kind you are authoring alongside this guide;
a new case should look like it.

## What an audio case is, and what gets seeded

A version lives under `test-cases/<type>/<difficulty>/<slug>/<version>/`. Versioning is per-case and
**immutable**: once a run references a version, that version is frozen. Revise by
adding a new version, never by editing a published one.

```text
test-cases/<type>/<difficulty>/<slug>/<version>/
  test-case.toml         # manifest: type, asset_kind, audio, tool, output, the overall domain
  variants/              # one standalone TOML file per variant (listed in `variants`)
  prompt.hbs             # rendered per run into the model's instruction (NOT seeded)
  description.md         # site-facing prose (NOT seeded)
  README.md              # human overview (NOT seeded)
  specs/brief.md         # the brief: what to build + how the tool behaves — SEEDED
```

A run receives only the seeded files: the selected variant's brief. There is **no
target clip** — the model builds to match the brief, not to copy a supplied
recording. It also gets the audio binary (`sfx-synth`, `sfx-sample`, or `music`)
on its `PATH`, whose `--help` is the operations contract — **no operations schema
is seeded** — plus a pre-seeded config next to the workspace
(`sfx-synth.config.json` / `sfx-sample.config.json` / `music.config.json`)
carrying the `[audio]` format and the log/preview/output paths, so no operation
needs those flags. For an `sfx-sample` or `music` case the run is scheduled onto
the image carrying the named pack or bank, so the library the model browses with
`list-samples` (or the instruments it names with `define-track`) is already
present. Everything marked *NOT seeded* is authoring- or site-side only.

Unlike the pixel tools, the audio binaries do **not** re-render after every call —
rendering is a separate, on-request `render` step that mixes the recorded ops down
to the `.wav` and draws the preview. The render is **deterministic** (synthesis
noise draws from a fixed seed; sample mixing is a pure function of the placed
layers), so replaying the recorded ops reproduces the same `.wav` — the recorded
operation log is the authoritative output. There is **no cheat-divergence check**
for audio (the emitted waveform is what is scored); the only contract check is that
the clip is well-formed, within the declared format, no longer than
`max_duration_ms`, and **not silent**.

## Procedure

### 1. Choose the kind, and what naming a pack or bank implies

Pick the `asset_kind` by what skill you want to measure:

- **`sfx-synth`** measures whether a model can build a sound from oscillators and
  noise alone — the rawest DSP tier. Name it when the sound is fundamentally
  synthetic (a laser, a UI blip, a sci-fi pulse) and you want no recorded material
  in play. It names **neither** a pack nor a bank.
- **`sfx-sample`** measures whether a model can select, layer, time, pitch, and
  process **library clips** the way a game-audio DAW does — the tier the hard 3D
  cases' weapon, naval, and footstep SFX use. It is a **superset** of `sfx-synth`
  (it still carries every synth voice, for glue), and it **must** name a
  `sample_pack = "name@version"`.
- **`music`** measures **composition** — pitches, beats, and durations on
  instrument tracks — the easiest of the three to author because the model works in
  the symbolic layer rather than shaping raw DSP. It **must** name an
  `instrument_bank = "name@version"` and emits a portable `.mid` beside the `.wav`.

**A named pack or bank is a `name@version` baked into the run-container image,
never a path in this repo.** The audio files are not committed here; a run
container is offline, so the palette is baked into the `sfx-sample` / `music`
image at build time and the case's manifest simply names **which** baked palette
it expects. The run is then scheduled onto the matching image. The
currently-published palettes a case can name today are **`combat-core`** (a sample
pack) and **`gm-lite`** (an instrument bank). If you need a palette that does not
exist yet, publish it first — see [Publishing an Audio Sample
Pack](/guides/authoring/publishing-an-audio-sample-pack/) — and pin its `name@version` here.
A `sample_pack`/`instrument_bank` value that is not pinned is a build error, not a
silent fallback, so a case can only name a palette that has been published.

Pick a catalog **slug** for the lineage (e.g. `spectra-laser`) and a `version`
(`vX.Y.Z`).

### 2. Write the brief

Write `specs/brief.md` — a single self-contained file. Because the reviewer hears
the finished clip against this text, describe the **sound**, not the operations:

- **the sound's character and role** — what it *is* and where a game uses it (a
  fighter's primary laser fire; a battleship's main-gun broadside; a short battle
  theme that plays over a briefing screen), in concrete sonic terms — bright vs.
  dark, tight vs. booming, its pitch register, its grit or cleanliness;
- **its envelope and timing within `max_duration_ms`** — the shape over time: a
  sharp transient attack, how long the body sustains, the decay and the tail. For
  music, the tempo, meter, and roughly how many bars it runs. State it so the whole
  clip fits inside the cap you set;
- **the layers, synth graph, or note material — conceptually** — for `sfx-synth`,
  the voices that stack (a low boom body, a noise crack, a pitch-swept zap); for
  `sfx-sample`, the kind of layers to composite from the pack (a deep cannon blast,
  a metal-debris tail, a synth sub for weight) — describe the *ingredients*, not the
  exact sample names, since the model must reason over the library itself; for
  `music`, the instruments, the melodic/harmonic idea, and the feel;
- **`mono` or `stereo`** — and, if stereo matters, how the image should be placed;
- **for `sfx-sample` / `music`, which pack or bank it draws from** — name it
  (e.g. "layer from the `combat-core` sample pack" / "voiced from the `gm-lite`
  instrument bank") so the brief matches the manifest, and remind the model it
  browses the library by metadata (`list-samples` / `sample-info`) because it
  cannot audition audio.

Also state **how the tool behaves**: that the audio binary is the only way to shape
sound, that it renders only on the `render` command (the model must call it to see
its waveform/spectrogram progress), that the recorded operations are the output,
and that it should read the binary's `--help` for the exact operation vocabulary.

The same self-containment and precise-values rules as any spec apply: the brief
must stand on its own, with no link outside the seeded set, and every audible
detail written in real terms. The shared **quality directive** (the brief is the
floor, not the goal — produce the best-sounding clip you can within its
constraints) is auto-prepended to every asset-generation prompt at render time, so
the brief need not restate it.

### 3. Write `prompt.hbs`

A short instruction that points the model at the seeded brief, tells it to read the
binary's `--help` for the operations (and, for a sampled kind, to browse the
library with `list-samples` first), and states the hard requirements: shape sound
only through the tool; call `render` to preview; keep the clip within
`max_duration_ms`; return when finished. The template renders in **strict mode**,
so use only the documented variables —
`{{variant.slug}}` / `{{variant.name}}` / `{{variant.description}}` and
`{{#each specs}}`.

### 4. Write the manifest

Author `test-case.toml` per the [schema](/testing/asset-generation/manifests/#audio-cases):

- **Metadata** — `name`, `difficulty`, and `tags`, all required and site-facing.
- **`type = "asset-generation"`** — required. Omitting it defaults to
  `end-to-end`, which then rejects the tables below.
- **`asset_kind`** — `"sfx-synth"`, `"sfx-sample"`, or `"music"`.
- **`[audio]`** — replaces the `[canvas]`/`[voxel]` table. It fixes the output
  format: `sample_rate` (Hz), `channels` (`"mono"` or `"stereo"`), and
  `max_duration_ms` (any positive clip-length cap), **all required**. An
  `sfx-sample` case additionally names **`sample_pack = "name@version"`**; a
  `music` case names **`instrument_bank = "name@version"`**; an `sfx-synth` case
  names **neither**.
- **`[tool]`** — the `binary` (matching the kind) and the `preview` path the binary
  writes the waveform + spectrogram to on `render` (a piano-roll as well, for
  `music`). **No operations schema** — the binary's `--help` is the contract.
- **`[output]`** — the `actions` op log the binary records; this is the
  **authoritative output**. Core emits the rendered `clip.wav` (and, for `music`, a
  portable `clip.mid`) automatically — these are **not** manifest-declared.
- **No `[model]`** — an audio case declares none; it authors one clip and is judged
  subjectively, with no required-animation contract.
- **`variants`** — an ordered array of paths to standalone variant files under
  `variants/` (the first is the default; at least one is required, usually `base`).
  As a root key it must precede the first table header. A variant here varies only
  the seeded **brief** (an additive `[[spec]]`) the model builds toward — a tighter
  register, a shorter cap, a required technique.
- **`[[domain]]`** — the single `overall` scoring domain, and **no `[[review_item]]`
  checklist**: the clip is judged as a whole against its brief, so the reviewer plays
  it, reads the brief, and gives one rating, which is the run's rating (see
  [Judged on one overall rating](/testing/asset-generation/manifests/#judged-on-one-overall-rating)).
  The domain is reporter-side and **not seeded**; everything a checklist item would
  have named belongs in the brief.

There is **no `[[reference]]`** (an audio case has no target clip), **no `[build]`
table**, and **no `[[check]]`** — declaring any is rejected.

Two realistic manifests. First, the `sfx-synth` worked example — a synthesized
laser blip, no pack:

```toml
# test-cases/asset-generation/medium/spectra-laser/v1.0.0/test-case.toml
slug       = "spectra-laser"
name       = "Spectra Laser"
difficulty = "easy"
tags       = ["asset-generation", "audio", "sfx", "synth"]
type       = "asset-generation"
asset_kind = "sfx-synth"
prompt     = "prompt.hbs"

variants = ["variants/base.toml"]

[audio]
sample_rate     = 44100      # output sample rate in Hz (required)
channels        = "mono"     # "mono" | "stereo" (required)
max_duration_ms = 600        # cap on the rendered clip's length in ms (required, positive)
                             # sfx-synth names NO sample_pack / instrument_bank

[tool]
binary  = "sfx-synth"        # the audio binary for this kind
preview = "waveform.png"     # where the binary writes the waveform + spectrogram on `render`

[output]
actions = "actions.json"     # the recorded op log; clip.wav is emitted automatically by core

# The self-contained brief, seeded for EVERY variant (dest defaults to source).
[[spec]]
source = "specs/brief.md"

[[domain]]
id = "overall"
name = "Overall"
description = "How good the produced asset is overall, judged against the brief."
```

Second, the `sfx-sample` worked example — `thunderhead-broadside`, layered over the
`combat-core` sample pack (a `music` case is identical in shape but names
`instrument_bank = "gm-lite@0.1.0"` instead of `sample_pack`, and its `preview`
also carries a piano-roll):

```toml
# test-cases/asset-generation/medium/thunderhead-broadside/v1.0.0/test-case.toml
slug       = "thunderhead-broadside"
name       = "Thunderhead Broadside"
difficulty = "hard"
tags       = ["asset-generation", "audio", "sfx", "naval"]
type       = "asset-generation"
asset_kind = "sfx-sample"
prompt     = "prompt.hbs"

variants = ["variants/base.toml"]

[audio]
sample_rate     = 44100          # output sample rate in Hz (required)
channels        = "stereo"       # "mono" | "stereo" (required)
max_duration_ms = 3500           # cap on the rendered clip's length in ms (required, positive)
sample_pack     = "combat-core@0.1.0"  # sfx-sample ONLY: the baked pack (name@version), never a repo path
                                 # (music would name instrument_bank = "gm-lite@0.1.0" instead)

[tool]
binary  = "sfx-sample"           # the audio binary for this kind
preview = "waveform.png"         # where the binary writes the waveform + spectrogram on `render`

[output]
actions = "actions.json"         # the recorded op log; clip.wav is emitted automatically by core

# The self-contained brief, seeded for EVERY variant (dest defaults to source).
[[spec]]
source = "specs/brief.md"

[[domain]]
id = "overall"
name = "Overall"
description = "How good the produced asset is overall, judged against the brief."
```

Each `variants` entry points at a standalone file whose top-level keys are the
variant's own fields; the `base` variant is usually just its `slug`/`name` and an
empty additive `spec = []`.

### 5. Write the non-seeded docs

`description.md` (site blurb) and `README.md` (human overview). These never reach a
run; keep them honest about what is seeded and which pack or bank the case expects.

## Validate your work

There is no separate authoring linter — you validate a case by resolving and
seeding it. For **every** variant:

```sh
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

`prompt` renders the instruction (catching strict-mode template errors and manifest
problems — including a missing `[audio]` field, a `sample_pack` on a non-`sfx-sample`
case, an `instrument_bank` on a non-`music` case, or a stray `[[reference]]`/`[build]`/
`[[check]]`). `seed` writes the seeded repository to disk so you can read exactly what
the model would receive — the brief plus the seeded audio config — and confirm it is
self-contained. If you named a `sample_pack` or `instrument_bank`, double-check it is a
published, pinned `name@version` (`combat-core` / `gm-lite` today); an unpinned palette
is a build error. When the case is ready, exercise it end to end with [Run a Test
Case](/quickstarts/development/run-a-test-case/).

## Next steps

- [Publishing an Audio Sample Pack](/guides/authoring/publishing-an-audio-sample-pack/) — if
  your case needs a pack or bank that does not exist yet, curate, publish, and pin
  it before naming it in the manifest.
- [Reviewing Test Run Results](/guides/development/reviewing-test-run-results/) — assess a run
  of your case, playing the clip against the brief.
