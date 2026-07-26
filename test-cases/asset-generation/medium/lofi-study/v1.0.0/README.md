# Lo-Fi Study Beat (`lofi-study`)

An **audio** asset-generation test case (`asset_kind = "music"`). It asks a model
to compose a **lo-fi hip-hop study beat** — a short, chilled, seamlessly looping
instrumental — using only the `music` sequencer binary, one recorded operation at
a time. There is **no target clip**; the model composes to match the written
brief.

## What it is

A warm, hazy, unhurried lo-fi loop: a laid-back head-nod drum groove (soft kick,
snare, hats) under a mellow electric-piano loop of jazzy 7th chords, a round bass,
and sparse vibraphone or glockenspiel motifs. It is `44100 Hz`, **stereo**, about
**30 seconds** long (up to the 30000 ms cap), and must loop seamlessly. The mood is
prescribed; the key, tempo, chord progression, and instrument choices are the
model's, so the case rewards compositional creativity over instruction-following.

## Layout

| File | Seeded? | Purpose |
| --- | --- | --- |
| `test-case.toml` | manifest | Metadata, `[audio]` (format + `instrument_bank = "gm-lite@0.1.0"`), `[tool]` (`music`), `[output]`, domain. |
| `specs/brief.md` | **seeded** | The self-contained brief: the mood to capture, length and loop, the instrumentation (model's choice), and the stereo image. |
| `variants/base.toml` | — | The single default variant. |
| `prompt.hbs` | rendered | The instruction handed to the harness (points at the brief and the tool). |
| `description.md` | — | Site-facing blurb. |
| `README.md` | — | This overview. |

## The instrument bank

The case names **`instrument_bank = "gm-lite@0.1.0"`** — a `name@version` palette
**baked into the `music` run-container image**, not a path in this repo. The audio
is not committed here; the run is scheduled onto the image carrying that bank, so
the general-MIDI-flavored palette (keys, guitars, bass, orchestral strings, brass,
woodwinds, mallets and bells, synths, and a drum kit) is already present. The brief
does **not** prescribe which instruments to use — that is the model's choice,
though the electric-piano and mallet voices are a natural fit for the style. Core
emits the rendered `clip.wav` and a portable `clip.mid` automatically — neither is
manifest-declared.

## Validate

```sh
tcab prompt --test-case lofi-study --version v1.0.0 --variant base
tcab seed   --test-case lofi-study --version v1.0.0 --variant base --out-dir <dir>
```

`prompt` renders the instruction (catching strict-mode template and manifest
errors); `seed` writes the seeded repository so you can confirm the brief is
self-contained.
