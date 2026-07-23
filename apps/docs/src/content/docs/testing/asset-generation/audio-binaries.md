---
title: Audio binaries
description: The procedural-synthesis, sample-mixing, and sequencer authoring interfaces and PCM .wav (+ .mid) output contract for the sfx-synth, sfx-sample, and music audio binaries.
---

An **audio** asset-generation run authors a clip through an **audio binary** on
its `PATH`, the only channel for shaping sound.
The clips are game audio: **sound effects** (weapons firing, footsteps, engines,
impacts, explosions) and **short music** (stingers, fanfares, loops). There are
three binaries, one per `asset_kind`, each measuring a different tier of
audio-authoring skill:

| Binary | `asset_kind` | what it measures |
| --- | --- | --- |
| **`sfx-synth`** | `sfx-synth` | **procedural synthesis** — a modular synth op graph, no samples: raw DSP and sound-design reasoning |
| **`sfx-sample`** | `sfx-sample` | **layered mixing over a sample library** — selection, layering, timing, and processing: the game-audio-DAW tier |
| **`music`** | `music` | a symbolic **sequencer** — notes on instrument tracks, rendered and emitted with a portable score |

`sfx-sample` is a **capability superset** of `sfx-synth`: it carries the same
synth voices and adds a baked **sample library** to mix over. The distinction is
the library and thus what is scored — `sfx-synth` measures whether a model can
build a sound from oscillators and noise alone, while `sfx-sample` measures
whether it can select, layer, time, and process library clips (with synth voices
for glue) the way a game-audio DAW does. The **hard 3D cases' weapon, naval, and
footstep SFX use `sfx-sample`**.

The DSP lives in `crates/audio-core` — the oscillators, noise, envelopes,
filters, and FM; the mixer and offline render engine; the WAV encoder; the
waveform, spectrogram, and piano-roll PNG renderers; and the shared CLI
record/preview/config plumbing (including the seeded noise source). Each binary
has its own crate (`crates/sfx-synth`, `crates/sfx-sample`, `crates/music`) and
is baked into its own [run-container
image](/components/core/execution/#containerization) — one image per `asset_kind`,
the `sfx-sample` and `music` images additionally carrying their [baked sample
pack and instrument bank](#the-sample-library) — so a run carries only the tool
it uses.

The emitted asset is a finished PCM **`.wav`** (`music` also emits a portable
**`.mid`** score). Because the clip is a finished waveform, an audio asset — unlike
a [voxel](/testing/asset-generation/voxel-binaries/) or
[particle](/testing/asset-generation/particle-binaries/) asset — has **no runtime
posing or simulation library**: a game plays the `.wav` directly, and the review
UI plays it in an `<audio>` element. There is nothing to pose or re-simulate; the
data *is* the sound.

## How a call records; rendering is on request

Each operation **only appends itself to the run's operation log** — that is all an
authoring call does. Mixing every voice, sample, and effect down to a waveform is
far more expensive than recording a parameter, and a clip takes many operations,
so — like the [mesh](/testing/asset-generation/mesh-binaries/) and
[voxel](/testing/asset-generation/voxel-binaries/) tools — these binaries do
**not** re-render after every call. Rendering is a separate, **on-request** step,
the `render` command. The orchestrator seeds a config next to the workspace
(`sfx-synth.config.json`, `sfx-sample.config.json`, or `music.config.json`)
carrying the audio parameters and the log, preview, and output (`.wav`, and for
`music` the `.mid`) paths, so neither an operation nor `render` needs those flags.
`init` seeds an **empty log**; a run starts pre-seeded.

The `[audio]` table a case declares fixes the clip's format: `sample_rate`,
`channels` (`mono` or `stereo`), and `max_duration_ms` (the clip-length cap). See
[Manifests](/testing/asset-generation/manifests/) for the table. The output is PCM
`.wav` — **binary**, per the [data-format
principle](/testing/asset-generation/overview/): bulk numeric audio is never JSON.

The render is **deterministic**. Synthesis noise draws from a **fixed seed** and
sample mixing is a pure function of the placed layers, so **replaying the recorded
ops reproduces the same `.wav`** — the same regenerate-from-actions guarantee the
other binaries carry, with the fixed seed standing in wherever the process would
otherwise be random. The recorded operation log is the authoritative output.

The **`render` command** mixes the recorded voices, samples, and effects down to
the clip and draws the **preview**: a **waveform + spectrogram PNG** (`music` also
renders a **piano-roll**). This is how the model sees its progress. It cannot hear
its output, so the preview is the honest substitute — the waveform shows the
**amplitude envelope** (attack, sustain, decay, the tail), and the spectrogram
shows the **spectral content over time**, so a transient, a pitch sweep, a filter
sweep, and a decaying tail are all **visible**. For `sfx-sample` the model further
reasons over the **named library samples' metadata** (their names, tags,
durations, and descriptions) rather than auditioning raw audio. Review is
otherwise **subjective**: a human plays the finished clip against the brief. See
[Evaluation](/testing/asset-generation/evaluation/).

## `sfx-synth` — procedural synthesis

`sfx-synth` builds a sound from nothing but oscillators and noise. It maintains a
**layered synth op graph**: **voices** on a timeline, each shaped by an envelope,
pitch, and modulation, routed through per-voice, bus, and master effects. A case
seeds **no** operations schema — the vocabulary is the binary's own `--help`, and
the brief tells the model to read it:

```
sfx-synth --help                 # every operation
sfx-synth add-voice --help       # one operation's exact flags
```

Each operation is a subcommand with flags — there is no JSON. For example, a
gunshot:

```
sfx-synth add-voice --name boom --wave sine --freq 120 --gain -3 --start 0 --dur 220
sfx-synth set-envelope --voice boom --attack 1 --decay 60 --sustain 0.2 --release 140
sfx-synth set-pitch --voice boom --slide-to 40 --over 180
sfx-synth add-voice --name crack --wave noise --gain -6 --start 0 --dur 40
sfx-synth add-filter --voice crack --type highpass --cutoff 2000
sfx-synth render
```

The operations are:

- **`add-voice`** — an oscillator or noise voice on the timeline:
  `--wave sine|square|saw|triangle|noise`, `--freq <hz>`, `--gain <db>`,
  `--pan`, `--start <ms>`, `--dur <ms>`.
- **`set-envelope`** — an amplitude envelope over a voice: ADSR
  (`--attack <ms> --decay <ms> --sustain <0..1> --release <ms>`) or an
  `--env <curve>` F-curve.
- **`set-pitch`** — a pitch sweep (`--slide-to <hz> --over <ms>`, or a pitch
  F-curve): a laser's fall, a boom's drop.
- **`add-vibrato`** / **`add-arpeggio`** — periodic pitch modulation
  (`--rate <hz>`, `--depth …`).
- **`add-fm`** — frequency modulation (`--carrier <v> --modulator <v> --index <k>`)
  for metallic and complex timbres.
- **`add-filter`** — a `lowpass|highpass|bandpass` filter on a `--voice` or `--bus`
  (`--cutoff <hz>`, optional `--sweep-to <hz> --over <ms>`, `--resonance …`).
- **`add-distortion`** / **`add-bitcrush`** / **`add-ringmod`** — waveshaping for
  grit, digital crush, and inharmonic clangor.
- **Bus and master FX** — `add-reverb --bus master --size --mix`, `add-delay`, and
  `add-compressor`.
- **`render`** — mix down to the `.wav` and draw the waveform/spectrogram PNG.

Layering multiple voices is how complexity is built. A gunshot is not one sound
but several stacked in time: a low **boom body**, a transient **crack**, a
mechanical **snap**, and a decaying **tail**. Building a sound by stacking simple
voices is the audio analogue of **compositing primitives** into a field — each
voice is a primitive, and the mix is the composite.

## `sfx-sample` — layered mixing over a sample library

`sfx-sample` is the **game-audio-DAW tier**: a layered multitrack mixer over a
baked [sample library](#the-sample-library). It is a **superset of `sfx-synth`** —
it carries every synth voice above, used for glue and sweeteners — and adds the
ability to place recorded library clips as layers. The library is the model's
**palette**; because the model cannot audition audio, it browses and reasons over
each sample's **name, tags, duration, and description**:

- **`list-samples`** (`[--tag <t>]`) / **`sample-info --name <n>`** — browse the
  baked library, reading each sample's stable name, tags, duration, and
  description.
- **`add-sample`** — place a library clip as a layer on the timeline:
  `--name <lib-sample> --t <ms>`, with optional `--gain <db>`,
  `--pitch <semitones>`, `--trim <in,out>`, `--fade-in <ms>`, `--fade-out <ms>`,
  and `--reverse`.
- **Synth voices** — the full `add-voice` … vocabulary from `sfx-synth`, for glue
  and sweeteners between the sampled layers.
- **Per-layer and bus FX** — the filters, waveshaping, and reverb/delay/compressor
  effects from `sfx-synth`, on a layer or a bus.
- **`render`** — mix down to the `.wav` and draw the waveform/spectrogram PNG.

For example, a naval main-gun broadside layered from library clips plus a synth
sub:

```
sfx-sample list-samples --tag explosion
sfx-sample add-sample --name cannon_blast_deep --t 0 --gain -1
sfx-sample add-sample --name debris_metal_impact --t 120 --gain -8 --fade-out 400
sfx-sample add-voice --name sub --wave sine --freq 45 --gain -4 --start 0 --dur 300
sfx-sample set-envelope --voice sub --attack 1 --decay 120 --sustain 0.1 --release 260
sfx-sample add-reverb --bus master --size 0.8 --mix 0.25
sfx-sample render
```

## `music` — sequencer

`music` is a symbolic **sequencer**: notes on instrument tracks over a tempo and
meter, rendered to audio and emitted alongside a portable score. It is the
**easiest of the three** to author, because the model works in the abstract
symbolic layer — pitches, beats, and durations — rather than shaping raw DSP or
selecting recorded clips.

- **`set-tempo --bpm <n>`** / **`set-time-signature --num --den`** — the clip's
  tempo and meter.
- **`define-track --name <n> --instrument <inst>`** — an instrument voice, either a
  **synth instrument** (a `sine`/`square`/`saw`/`triangle`/`noise` oscillator from
  `audio-core`) or a **sample-based instrument** named from the baked
  [instrument bank](#the-sample-library). A melodic bank instrument is pitch-shifted per
  note from the note it was recorded at; a percussion instrument plays at its native
  pitch. (A bank name with no baked pack falls back to a mellow triangle, so a run still
  renders.)
- **`add-note`** — a note event on a track: `--track <n> --pitch <C4|midi-number>
  --t <beat|ms> --dur <beat|ms>`, with an optional `--velocity 0..127`.
- **`set-track-fx --track <n>`** — per-track processing (`--gain`, `--pan`,
  `--reverb`, `--env …`).
- **`render`** — mix down to the `.wav`, draw a **piano-roll** PNG preview, and emit
  a portable **`.mid`** score alongside `music.wav`.

The `.mid` is the score-as-metadata companion to the `.wav`: the `.wav` is the
**ready asset** a game plays directly, while the `.mid` lets a game
**re-synthesize the piece in-engine** with its own instruments.

## Live preview

When a run is being **watched** — driven by a [driver](/components/driver/overview/)
or the [Tauri app](/components/tauri/overview/) rather than a plain `tcab run` — the
model's authoring is streamed to the viewer in real time, mechanically identical to
the [sprite](/testing/asset-generation/sprite-binaries/#live-preview) and
[mesh](/testing/asset-generation/mesh-binaries/#live-preview) tools. The
orchestrator adds a `live` block (a `host.docker.internal:host-gateway` endpoint
and an opaque per-run token) to the seeded config, and **when the model runs
`render`** the binary connects back to the run host and streams a one-line JSON
header (`{ token, frame, operationCount, operation, length, audioLength }`)
followed by the freshly rendered preview PNG's raw bytes and then the clip's
current `.wav` bytes (`audioLength` bytes). The audio body lets a watcher **play
the clip as it is built**, rather than seeing only the still preview; a
preview-only viewer simply ignores it. Streaming is **best-effort and
non-essential** — absent for an unwatched run, never fails an operation, and never
recorded; the recorded **operation log** and the emitted `.wav` remain the run's
authoritative output.

## The sample library

`sfx-sample`'s **sample library** and `music`'s **instrument bank** are **baked
into their run-container image at image-build time** — the fixed palette each tool
ships with, exactly as the binary itself is baked in. A run container is
[isolated and offline](/components/core/execution/#containerization), so nothing is
fetched at run time; the library the model browses with `list-samples` is already
present in the image.

The audio files themselves are **not committed to this repo**. What the repo
commits is a small **pack manifest** — `containers/sample-packs/<pack>.toml` —
listing, for each sample, its stable `name`, `tags`, `description`, `license`, a
source URL, and a `sha256` content hash. The **`license`** must be **CC0 or
otherwise permissive**, so that produced clips are freely usable in test cases and
published runs. The shipped combat palette (`combat-core`) is sourced from
[Freesound](https://freesound.org) CC0 clips through its free token API — see
`containers/sample-packs/README.md` ("Freesound sources") for the sourcing details.

The library must be a palette of **elemental ingredients, not finished effects**. An
entry is a single *layer* — a sub-bass body, a dry metal impact, a debris tail, a
mechanical reload click, an air whoosh, an electric arc — that the model **composites**
into a specific weapon, vehicle, or explosion by selecting, layering, timing, pitching,
and processing several (with synth voices for glue). This is what makes `sfx-sample` an
*authoring* task rather than a lookup: if the library instead held ready-made gunshots
or explosions, a single `add-sample; render` would satisfy the brief and there would be
nothing to author. A sample is a **primitive**; the finished clip is the **composite** —
the same relationship the [mesh](/testing/asset-generation/mesh-binaries/) and
[voxel](/testing/asset-generation/voxel-binaries/) tools have between a CSG primitive and
the sculpted field. For the same reason, the browse metadata (`name`, `tags`,
`description`) states only what each clip **is** — its source, timbre, and character —
and gives **no** usage, layering, or processing guidance; how to combine the primitives
is the reasoning under test, not something the palette supplies.

The pack itself is a **separately-versioned, content-addressed artifact** (an
object-storage tarball / OCI artifact), built by `scripts/build-sample-pack.mjs`,
which fetches the sources named in the manifest, **verifies each `sha256`**,
**normalizes** them (sample rate, loudness, trim, format), and assembles the pack.
The image build **pins a pack version by digest** and bakes it in, so the baked
palette is immutable and versioned with the image. **Updating the library is a new
pack version plus an image rebuild** — never an in-place edit. The instrument bank
`music` ships with follows the same model.

A case does **not** point at a repo path: its `[audio]` table names **which baked
pack or bank** it expects — a `sample_pack` or `instrument_bank` name and version.
The **`music` image bakes every instrument bank** as a per-name subdirectory, so the
named `instrument_bank` *selects* which palette a run plays (an `sfx-sample` run bakes
its one sample pack). Three instrument banks ship today: **`gm-lite`** (a broad
general-MIDI palette), **`cinematic`** (epic orchestral — sectioned strings, brass,
mixed choir, orchestral percussion), and **`synthwave`** (analog synths, pads, FM
bells, an electronic drum machine) — a `music` case picks one to match its genre. See
[Manifests](/testing/asset-generation/manifests/) for the table and
`containers/sample-packs/README.md` for how a bank is curated, published, and baked.
