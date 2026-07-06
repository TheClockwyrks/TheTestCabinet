# Thunderhead Theme (`thunderhead-theme`)

An **audio** asset-generation test case (`asset_kind = "music"`). It asks a model
to compose the **Thunderhead battle theme** — a short, clean-looping naval-battle
music cue for the *Thunderhead* fleet-command game — using only the `music`
sequencer binary, one recorded operation at a time. There is **no target clip**;
the model composes to match the written brief.

## What it is

A driving, militaristic **minor-key** cue with a steady low pulse, a determined
melodic line, and a sense of building tension, sequenced as notes on instrument
tracks over the baked **`gm-lite`** instrument bank. It is `44100 Hz`, **stereo**,
at most **8000 ms** long (about four bars), and must **loop cleanly**.

## Layout

| File | Seeded? | Purpose |
| --- | --- | --- |
| `test-case.toml` | manifest | Metadata, `[audio]` (format + `instrument_bank = "gm-lite@0.1.0"`), `[tool]` (`music`), `[output]`, domains, reviewer checklist. |
| `specs/brief.md` | **seeded** | The self-contained brief: mood and role, tempo and key, the instrument tracks and parts, the arrangement, the clean loop, and the stereo image. |
| `variants/base.toml` | — | The single default variant. |
| `prompt.hbs` | rendered | The instruction handed to the harness (points at the brief and the tool). |
| `description.md` | — | Site-facing blurb. |
| `README.md` | — | This overview. |

## The instrument bank

The case names **`instrument_bank = "gm-lite@0.1.0"`** — a `name@version` palette
**baked into the `music` run-container image**, not a path in this repo. The audio
is not committed here; the run is scheduled onto the image carrying that bank, so
the instruments the brief names (`bass_electric`, `drum_tom`, `string_ensemble`,
`french_horn`, `trumpet`, and the rest of `gm-lite`) are already present. Core
emits the rendered `clip.wav` and a portable `clip.mid` automatically — neither is
manifest-declared.

## Validate

```sh
tcab prompt --test-case thunderhead-theme --version v1.0.0 --variant base
tcab seed   --test-case thunderhead-theme --version v1.0.0 --variant base --out-dir <dir>
```

`prompt` renders the instruction (catching strict-mode template and manifest
errors); `seed` writes the seeded repository so you can confirm the brief is
self-contained.
