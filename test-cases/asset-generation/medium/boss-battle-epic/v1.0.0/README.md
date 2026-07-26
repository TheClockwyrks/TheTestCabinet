# Epic Boss Battle (`boss-battle-epic`)

An **audio** asset-generation test case (`asset_kind = "music"`). It asks a model
to compose an **epic boss-battle theme** — a short cinematic combat cue for a
towering final-boss encounter — using only the `music` sequencer binary, one
recorded operation at a time. There is **no target clip**; the model composes to
match the written brief.

## What it is

A **dark, driving, menacing** orchestral cue for a high-stakes final-boss fight —
a relentless low taiko pulse under aggressive low-brass stabs and tense tremolo
strings, a biting pizzicato ostinato, ominous choir swells, and cymbal accents on
the turns, propulsive and charged with dread and adrenaline. It is `44100 Hz`,
**stereo**, about **30 seconds** long (up to the 30000 ms cap), and should loop
cleanly for a sustained fight. The mood is prescribed; the key, tempo, structure,
and instrument choices are the model's, so the case rewards compositional
creativity over instruction-following.

## Layout

| File | Seeded? | Purpose |
| --- | --- | --- |
| `test-case.toml` | manifest | Metadata, `[audio]` (format + `instrument_bank = "cinematic@0.1.0"`), `[tool]` (`music`), `[output]`, domain. |
| `specs/brief.md` | **seeded** | The self-contained brief: what the cue is, the mood to capture, length and loop, the instrumentation (model's choice), and the stereo image. |
| `variants/base.toml` | — | The single default variant. |
| `prompt.hbs` | rendered | The instruction handed to the harness (points at the brief and the tool). |
| `description.md` | — | Site-facing blurb. |
| `README.md` | — | This overview. |

## The instrument bank

The case names **`instrument_bank = "cinematic@0.1.0"`** — a `name@version` palette
**baked into the `music` run-container image**, not a path in this repo. The audio
is not committed here; the run is scheduled onto the image carrying that bank, so
the orchestral palette (tremolo and ensemble strings, solo cello and pizzicato,
horns, low brass, and trumpet, aah/ooh choir, oboe and flute, celesta and harp, and
taiko, bass drum, and cymbal percussion) is already present. The brief does **not**
prescribe which instruments to use — that is the model's choice. Core emits the
rendered `clip.wav` and a portable `clip.mid` automatically — neither is
manifest-declared.

## Validate

```sh
tcab prompt --test-case boss-battle-epic --version v1.0.0 --variant base
tcab seed   --test-case boss-battle-epic --version v1.0.0 --variant base --out-dir <dir>
```

`prompt` renders the instruction (catching strict-mode template and manifest
errors); `seed` writes the seeded repository so you can confirm the brief is
self-contained.
