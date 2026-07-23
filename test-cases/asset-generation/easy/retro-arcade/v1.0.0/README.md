# Retro Arcade Loop (`retro-arcade`)

An **audio** asset-generation test case (`asset_kind = "music"`). It asks a model
to compose a **retro arcade action loop** — a short, upbeat background music cue
for a fast-paced arcade game — using only the `music` sequencer binary, one
recorded operation at a time. There is **no target clip**; the model composes to
match the written brief.

## What it is

An **upbeat, fast, adrenal chiptune** loop — a bright bouncy square lead over a
punchy synth bass and a quick electronic drum groove, with snappy pluck and FM-bell
counter-melodies driving momentum: the sound of an 80s arcade cabinet mid high-score
run. It is `44100 Hz`, **stereo**, about **25 seconds** long (up to the 25000 ms
cap), and must loop seamlessly. The mood is prescribed; the key, tempo, structure,
and instrument choices are the model's, so the case rewards compositional creativity
over instruction-following.

## Layout

| File | Seeded? | Purpose |
| --- | --- | --- |
| `test-case.toml` | manifest | Metadata, `[audio]` (format + `instrument_bank = "synthwave@0.1.0"`), `[tool]` (`music`), `[output]`, domains, reviewer checklist. |
| `specs/brief.md` | **seeded** | The self-contained brief: the mood to capture, length and loop, the instrumentation (model's choice), and the stereo image. |
| `variants/base.toml` | — | The single default variant. |
| `prompt.hbs` | rendered | The instruction handed to the harness (points at the brief and the tool). |
| `description.md` | — | Site-facing blurb. |
| `README.md` | — | This overview. |

## The instrument bank

The case names **`instrument_bank = "synthwave@0.1.0"`** — a `name@version` palette
**baked into the `music` run-container image**, not a path in this repo. The audio
is not committed here; the run is scheduled onto the image carrying that bank, so
the vintage-synth palette (bright lead and melody voices, punchy synth and sub
bass, warm pads and synth brass/strings, and an electronic drum machine) is already
present. The brief does **not** prescribe which instruments to use — that is the
model's choice. Core emits the rendered `clip.wav` and a portable `clip.mid`
automatically — neither is manifest-declared.

## Validate

```sh
tcab prompt --test-case retro-arcade --version v1.0.0 --variant base
tcab seed   --test-case retro-arcade --version v1.0.0 --variant base --out-dir <dir>
```

`prompt` renders the instruction (catching strict-mode template and manifest
errors); `seed` writes the seeded repository so you can confirm the brief is
self-contained.
