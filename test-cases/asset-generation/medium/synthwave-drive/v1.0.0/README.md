# Synthwave Night Drive (`synthwave-drive`)

An **audio** asset-generation test case (`asset_kind = "music"`). It asks a model
to compose a **retro-80s synthwave "night drive" loop** — a short, atmospheric cue
built to cruise on repeat — using only the `music` sequencer binary, one recorded
operation at a time. There is **no target clip**; the model composes to match the
written brief.

## What it is

A **neon, cruising, wistful** cue — an empty highway at night, city lights, chrome —
over a four-on-the-floor electronic drum-machine backbeat, with a pulsing
arpeggiated bass, warm analog pads, a nostalgic saw/square lead, and glassy FM-bell
accents. It is `44100 Hz`, **stereo**, about **30 seconds** long (up to the 30000 ms
cap), and should loop seamlessly. The mood is prescribed; the key, tempo, structure,
and instrument choices are the model's, so the case rewards compositional creativity
over instruction-following.

## Layout

| File | Seeded? | Purpose |
| --- | --- | --- |
| `test-case.toml` | manifest | Metadata, `[audio]` (format + `instrument_bank = "synthwave@0.1.0"`), `[tool]` (`music`), `[output]`, domain. |
| `specs/brief.md` | **seeded** | The self-contained brief: the mood to capture, length and loop, the instrumentation (model's choice), and the stereo image. |
| `variants/base.toml` | — | The single default variant. |
| `prompt.hbs` | rendered | The instruction handed to the harness (points at the brief and the tool). |
| `description.md` | — | Site-facing blurb. |
| `README.md` | — | This overview. |

## The instrument bank

The case names **`instrument_bank = "synthwave@0.1.0"`** — a `name@version` palette
**baked into the `music` run-container image**, not a path in this repo. The audio
is not committed here; the run is scheduled onto the image carrying that bank, so
the vintage-synth palette (`square_lead`, `pluck`, `synth_bass`, `sub_bass`,
`warm_pad`, `analog_pad`, `fm_bell`, `synth_brass`, `synth_strings`, and an
electronic drum machine of `kick_808`, `snare_electronic`, `clap`, `hat_closed`,
`hat_open`, and `tom_electronic`) is already present. The brief does **not**
prescribe which instruments to use — that is the model's choice. Core emits the
rendered `clip.wav` and a portable `clip.mid` automatically — neither is
manifest-declared.

## Validate

```sh
tcab prompt --test-case synthwave-drive --version v1.0.0 --variant base
tcab seed   --test-case synthwave-drive --version v1.0.0 --variant base --out-dir <dir>
```

`prompt` renders the instruction (catching strict-mode template and manifest
errors); `seed` writes the seeded repository so you can confirm the brief is
self-contained.
