# Jazz Lounge Loop — `v1.0.0`

An audio asset-generation test case (`asset_kind = "music"`). It asks a model to
compose a smooth late-night jazz lounge loop, a short background cue for a dim,
intimate cocktail bar, using only the `music` sequencer binary, one recorded
operation at a time. There is no target clip; the model composes to match the
written brief.

## What it is

A relaxed-swing lounge jazz cue: a walking bass line under warm electric-piano
comping, a soft brushed-kit-style groove keeping time, and a laid-back saxophone
or muted-trumpet melody trading phrases with the piano, intimate, cool, and
sophisticated. It is `44100 Hz`, stereo, and about 30 seconds long, up to the
30000 ms cap, and should come to rest so it can loop. The mood is prescribed,
while the key, tempo, structure, and instrument choices are the model's, so the
case rewards compositional creativity over instruction-following.

## Layout

| File | Seeded? | Purpose |
| --- | --- | --- |
| `test-case.toml` | manifest | Metadata, `[audio]` (format + `instrument_bank = "gm-lite@0.1.0"`), `[tool]` (`music`), `[output]`, domain. |
| `specs/brief.md` | seeded | The self-contained brief: the mood to capture, length and loop, the instrumentation (model's choice), and the stereo image. |
| `variants/base.toml` | — | The single default variant. |
| `prompt.hbs` | rendered | The instruction handed to the harness (points at the brief and the tool). |
| `description.md` | — | Site-facing blurb. |
| `README.md` | — | This overview. |

## The instrument bank

The case names `instrument_bank = "gm-lite@0.1.0"`, a `name@version` palette
baked into the `music` run-container image. It is not a path in this repo, and
the audio is not committed here. The run is scheduled onto the image carrying
that bank, so its general-MIDI-flavoured palette is already present:

- a grand and electric piano
- music box, marimba, vibraphone and glockenspiel
- nylon and electric guitar, electric bass
- strings, brass, woodwinds
- two synths
- a drum kit

Core emits the rendered `clip.wav` and a portable `clip.mid` automatically;
neither is manifest-declared.

## Validate

```sh
tcab prompt --test-case jazz-lounge --version v1.0.0 --variant base
tcab seed   --test-case jazz-lounge --version v1.0.0 --variant base --out-dir <dir>
```

`prompt` renders the instruction and catches strict-mode template and manifest
errors. `seed` writes the seeded repository so you can confirm the brief is
self-contained.
