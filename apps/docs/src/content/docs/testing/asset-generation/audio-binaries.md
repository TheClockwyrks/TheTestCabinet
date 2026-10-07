---
title: Audio binaries
description: The procedural-synthesis, sample-mixing, and sequencer authoring interfaces and PCM .wav (+ .mid) output contract for the sfx-synth, sfx-sample, and music audio binaries.
---

An audio asset-generation run authors a clip through an audio binary on its
`PATH`, the only channel for shaping sound. The clips are game audio: sound
effects such as weapons firing, footsteps, engines, impacts, and explosions, and
short music such as stingers, fanfares, and loops. There are three binaries, one
per `asset_kind`, each measuring a different tier of audio-authoring skill.

| Binary       | `asset_kind` | What it measures                                                                                            |
| ------------ | ------------ | ----------------------------------------------------------------------------------------------------------- |
| `sfx-synth`  | `sfx-synth`  | procedural synthesis — a modular synth op graph: raw DSP and sound-design reasoning                         |
| `sfx-sample` | `sfx-sample` | layered mixing over a sample library — selection, layering, timing, and processing: the game-audio-DAW tier |
| `music`      | `music`      | a symbolic sequencer — notes on instrument tracks, rendered and emitted with a portable score               |

`sfx-sample` is a capability superset of `sfx-synth`: it carries the same synth
voices and adds a sample library to mix over. The library is what changes
the score. `sfx-synth` measures whether a model can build a sound from
oscillators and noise alone, while `sfx-sample` measures whether it can select,
layer, time, and process library clips, with synth voices for glue, the way a
game-audio DAW does. The hard 3D cases' weapon, naval, and footstep SFX use
`sfx-sample`.

The DSP lives in `crates/audio-core`: the oscillators, noise, envelopes, filters,
and FM; the mixer and offline render engine; the WAV encoder; the waveform,
spectrogram, and piano-roll PNG renderers; and the shared CLI record, preview,
and config plumbing. Each binary has its own crate (`crates/sfx-synth`,
`crates/sfx-sample`, `crates/music`) and its own asset-generation run-container
image, so an audio asset-generation run carries only the tool its `asset_kind`
names. Both [full-stack](/testing/full-stack/overview/) images carry all three
binaries, because one full-stack run produces every asset its game needs.

The emitted asset is a finished PCM `.wav`, and `music` also emits a portable
`.mid` score. The clip is a finished waveform, so a game plays the `.wav`
directly and the review UI plays it in an `<audio>` element. The data is the
sound.

## Recording and on-request rendering

Each authoring operation appends itself to the run's operation log and nothing
more. Mixing every voice, sample, and effect down to a waveform costs far more
than recording a parameter, and a clip takes many operations, so rendering is a
separate, on-request step. The orchestrator seeds a config next to the workspace
(`sfx-synth.config.json`, `sfx-sample.config.json`, or `music.config.json`)
carrying the audio parameters, the synthesis seed, the pack it plays, and the
log, preview, and output paths, so neither an operation nor `render` needs
those flags. `init` writes an empty log; a run starts pre-seeded.

The `[audio]` table a case declares fixes the clip's format: `sample_rate`,
`channels` (`mono` or `stereo`), and `max_duration_ms`, the clip-length cap. The
output is PCM `.wav`, binary per the
[data-format principle](/testing/asset-generation/overview/), since bulk numeric
audio is never JSON.

The render is deterministic. Synthesis noise draws from a fixed seed carried in
the config, and sample mixing is a pure function of the placed layers, so
replaying the recorded operations reproduces the same `.wav`. The recorded
operation log is the authoritative output.

`render` mixes the recorded voices, samples, and effects down to the clip and
draws the preview PNG: a waveform panel plus a spectrogram, with `music` adding a
piano-roll. This is how the model sees its progress. It cannot hear its output,
so the preview is the honest substitute. The waveform shows the amplitude
envelope, the attack, sustain, decay, and tail; the spectrogram shows spectral
content over time, so a transient, a pitch sweep, a filter sweep, and a decaying
tail are all visible. For `sfx-sample` the model further reasons over the named
library samples' metadata rather than auditioning raw audio. Review is otherwise
subjective: a human plays the finished clip against the brief.

## `sfx-synth` — procedural synthesis

`sfx-synth` builds a sound from oscillators and noise. It maintains a layered
synth op graph: voices on a timeline, each shaped by an envelope, pitch, and
modulation, routed through per-voice, bus, and master effects. The vocabulary is
the binary's own `--help`, and the brief tells the model to read it:

```
sfx-synth --help                 # every operation
sfx-synth add-voice --help       # one operation's exact flags
```

Every operation is a subcommand with flags. A gunshot, for example:

```
sfx-synth add-voice --name boom --wave sine --freq 120 --gain -3 --start 0 --dur 220
sfx-synth set-envelope --voice boom --attack 1 --decay 60 --sustain 0.2 --release 140
sfx-synth set-pitch --voice boom --slide-to 40 --over 180
sfx-synth add-voice --name crack --wave noise --gain -6 --start 0 --dur 40
sfx-synth add-filter --voice crack --type highpass --cutoff 2000
sfx-synth render
```

The operations:

- `add-voice` places an oscillator or noise voice on the timeline:
  `--name`, `--wave <sine|square|saw|triangle|noise>`, `--freq <hz>`,
  `--gain <db>`, `--pan <-1..1>`, `--start <ms>`, and `--dur <ms>`.
- `set-envelope --voice` shapes a voice's amplitude, either as an ADSR
  (`--attack <ms> --decay <ms> --sustain <0..1> --release <ms>`) or as a named
  preset curve `--env <linear|pluck|swell|punch|gate>`.
- `set-pitch --voice --slide-to <hz> --over <ms>` sweeps a voice's pitch: a
  laser's fall, a boom's drop.
- `add-vibrato` and `add-arpeggio` add periodic pitch modulation to a `--voice`,
  taking `--rate <hz>` and `--depth <semitones>`.
- `add-fm --voice --carrier <ratio> --modulator <ratio> --index <k>` adds
  frequency modulation for metallic and complex timbres.
- `add-filter --type <lowpass|highpass|bandpass> --cutoff <hz>` filters a
  `--voice` or a `--bus`, with an optional `--sweep-to <hz> --over <ms>` and a
  `--resonance`.
- `add-distortion --drive`, `add-bitcrush --bits --rate`, and
  `add-ringmod --freq` waveshape a `--voice` or a `--bus` for grit, digital
  crush, and inharmonic clangor.
- `add-reverb --bus --size --mix`, `add-delay --bus --time --feedback --mix`, and
  `add-compressor --bus --threshold --ratio` process a bus, `master` by default.
- `render` mixes down to the `.wav` and draws the waveform and spectrogram PNG.

Layering multiple voices is how complexity is built. A gunshot is not one sound
but several stacked in time: a low boom body, a transient crack, a mechanical
snap, and a decaying tail. Building a sound by stacking simple voices is the
audio analogue of compositing primitives into a field, where each voice is a
primitive and the mix is the composite.

## `sfx-sample` — layered mixing over a sample library

`sfx-sample` is the game-audio-DAW tier: a layered multitrack mixer over a
[sample library](#the-sample-library). It carries every synth voice above, used
for glue and sweeteners, and adds the ability to place recorded library clips as
layers. The library is the model's palette, and because the model cannot audition
audio it browses and reasons over each sample's name, tags, duration, and
description.

- `list-samples [--tag <t>]` and `sample-info --name <n>` browse the library.
  Both record nothing.
- `add-sample --name <lib-sample> --t <ms>` places a library clip as a layer on
  the timeline, with optional `--gain <db>`, `--pitch <semitones>`,
  `--trim <in,out>`, `--fade-in <ms>`, `--fade-out <ms>`, and `--reverse`.
  `--name` must be a sample the library carries; any other name is an error.
- The full `add-voice` vocabulary from `sfx-synth` supplies glue and sweeteners
  between the sampled layers.
- The filters, waveshaping, and reverb, delay, and compressor effects from
  `sfx-synth` apply to a layer or a bus.
- `render` mixes down to the `.wav` and draws the waveform and spectrogram PNG.

A naval main-gun broadside layered from library clips plus a synth sub:

```
sfx-sample list-samples --tag explosion
sfx-sample add-sample --name cannon_body_heavy --t 0 --gain -1
sfx-sample add-sample --name impact_metal_dry --t 120 --gain -8 --fade-out 400
sfx-sample add-voice --name sub --wave sine --freq 45 --gain -4 --start 0 --dur 300
sfx-sample set-envelope --voice sub --attack 1 --decay 120 --sustain 0.1 --release 260
sfx-sample add-reverb --bus master --size 0.8 --mix 0.25
sfx-sample render
```

## `music` — sequencer

`music` is a symbolic sequencer: notes on instrument tracks over a tempo and
meter, rendered to audio and emitted alongside a portable score. It is the
easiest of the three to author, because the model works in the abstract symbolic
layer of pitches, beats, and durations rather than shaping raw DSP or selecting
recorded clips.

- `set-tempo --bpm <n>` and `set-time-signature --num --den` fix the clip's tempo
  and meter.
- `list-instruments [--tag <t>]` and `instrument-info --name <n>` browse the
  bank the way `list-samples` and `sample-info` browse a sample library. Both
  record nothing.
- `define-track --name <n> --instrument <inst>` declares an instrument voice. The
  instrument is either a synth waveform (`sine`, `square`, `saw`, `triangle`,
  `noise`) or a sample-based instrument named from the
  [instrument bank](#the-sample-library). A melodic bank instrument is
  pitch-shifted per note from the note it was recorded at, and a percussion
  instrument plays at its native pitch. An `--instrument` matching neither a
  synth waveform nor a bank instrument is an error.
- `add-note --track <n> --pitch <C4|midi-number> --t <beats> --dur <beats>` adds
  a note event, with an optional `--velocity 1..127`.
- `set-track-fx --track <n>` sets per-track processing: `--gain <db>`,
  `--pan <-1..1>`, `--reverb <0..1>`, and `--env <linear|pluck|swell|punch|gate>`.
- `render` mixes down to the `.wav`, draws the waveform, spectrogram, and
  piano-roll preview, and emits the portable `.mid` score alongside the clip.

The `.mid` is the score-as-metadata companion to the `.wav`. The `.wav` is the
ready asset a game plays directly, and the `.mid` lets a game re-synthesize the
piece in-engine with its own instruments.

## Live preview

When a run is watched, driven by a [driver](/components/driver/overview/)
rather than a plain `tcab run`, the
model's authoring streams to the viewer in real time. The orchestrator adds a
`live` block to the seeded config carrying a `host.docker.internal:host-gateway`
endpoint and an opaque per-run token. When the model runs `render`, the binary
connects back to the run host and streams a one-line JSON header
(`{ token, frame, operation, operationCount, length, audioLength }`) followed by
the freshly rendered preview PNG's raw bytes and then the clip's current `.wav`
bytes. The audio body lets a watcher play the clip as it is built; a
preview-only viewer ignores it.

Streaming is best-effort: it is absent for an unwatched run, it never fails an
operation, and it is never recorded. The recorded operation log and the emitted
`.wav` remain the run's authoritative output.

## The sample library

`sfx-sample`'s sample library and `music`'s instrument bank are the palette a run
mixes and sequences over. A case declares the packs it may reach in its `[audio]`
table's `packs` list, each a `name@version` ref rather than a repo path. Those
packs are staged into the run container under `/opt/audio` when the container
starts, and the container carries their clips and nothing besides, so the library
the model browses with `list-samples` or `list-instruments` is exactly the one its
case declared.

An audio asset-generation case declares the single pack its binary plays, a
sample pack for `sfx-sample` and an instrument bank for `music`. A full-stack or
game-jam run writes its own tool config and may be given several packs, and a
config that names no pack plays the first declared pack of its kind.
[Staged audio](/components/core/execution/#staged-audio) covers how a run
receives them.

Running a binary on a host instead of in a run container, as a reference
implementation's asset build does, points it at an audio store with
`TCAB_AUDIO_DIR`. A store and a staged tree share one layout, so a store fetched
with `scripts/fetch-audio-store.sh` reads as a palette of every pack it carries,
with the first pack of each kind that kind's default.

The loaded pack is checked against the ref the config pins: the pack's own `name`
and `version` must equal it, and naming a pack the run was not staged with is an
error listing the packs it was. Every entry's audio is checked with it, and must
decode at the pack's declared sample rate and run for the length the entry
declares, so a pack disagreeing with its own manifest fails at load rather than
rendering a sound the model was told something else about.

A clip is one audio source, identified by the sha256 of its original source
bytes. `containers/sample-packs/clips.toml` commits one entry per clip recording
the facts intrinsic to the recording: its `license`, its `source_url` and any
upstream id for provenance, and for a pitched recording the MIDI note it was
recorded at (`root_note`). The `license` must be CC0 or otherwise permissive, so
that produced clips are freely usable in test cases and published runs. The
shipped palettes are sourced from [Freesound](https://freesound.org) CC0 clips.

How a clip is presented belongs to the pack that uses it, so two packs may name
one clip differently: `gm-lite` calls a recording `trombone` where `cinematic`
calls it `low_brass`. A pack manifest, `containers/sample-packs/<pack>.toml`, is
a collection of clip ids plus the `[normalize]` profile every clip in it is
rendered through, covering sample rate, channels, loudness, true peak, silence
trim, and duration cap. Each `[[entry]]` names a `clip` id and carries that
pack's presentation of it: `name`, `tags`, `description`, `pitched`, and an
optional `root_note` override. The source url and the content hash are facts of
the clip and live in the registry.

Clip bytes live in a Test Cabinet object store holding each clip's original
source and, per normalize profile, the normalized wav rendered from it. Every
published pack is assembled out of that store into a host-side audio store, from
which staging copies the declared packs' manifests plus the one shared clip
directory those manifests point into, so a clip two packs share is stored and
staged once. Publishing a pack version publishes its clips and its manifest to
that store, and a case reaches the new version by pinning it in `[audio] packs`.
`containers/sample-packs/README.md` covers how a clip is ingested and how a pack
is published.

The library must be a palette of elemental ingredients. An entry is a single
layer, a sub-bass body, a dry metal impact, a debris tail, a mechanical reload
click, an air whoosh, an electric arc, that the model composites into a specific
weapon, vehicle, or explosion by selecting, layering, timing, pitching, and
processing several, with synth voices for glue. That composition is what makes
`sfx-sample` an authoring task rather than a lookup: a library of ready-made
gunshots would let a single `add-sample; render` satisfy the brief. A sample is a
primitive and the finished clip is the composite, the same relationship the
[mesh](/testing/asset-generation/mesh-binaries/) tools have between a CSG
primitive and the sculpted field. For the same reason, the browse metadata states
only what each clip is, its source, timbre, and character. How to combine the
primitives is the reasoning under test.

An instrument bank is named by its instrument (`grand_piano`, `violin`), because
a `music` case measures composition rather than identification. Each melodic
entry resolves a `root_note` so the sequencer pitch-shifts it correctly across a
track's notes; percussion entries set `pitched = false` and play native. Three
instrument banks ship: `gm-lite`, a broad general-MIDI palette; `cinematic`, epic
orchestral with sectioned strings, brass, mixed choir, and orchestral percussion;
and `synthwave`, analog synths, pads, FM bells, and an electronic drum machine. A
`music` case declares the one that matches its genre, and the one sample pack
that ships, `combat-core`, is declared the same way by an `sfx-sample` case.
