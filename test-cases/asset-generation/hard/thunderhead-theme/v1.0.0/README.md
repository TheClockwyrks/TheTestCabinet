# Thunderhead Theme — `v1.0.0`

An audio asset-generation test case (`asset_kind = "music"`). It asks a model to
compose the Thunderhead main-menu theme, a long, grand, cinematic main-title
overture for the _Thunderhead_ fleet-command game, using only the `music`
sequencer binary, one recorded operation at a time. There is no target clip; the
model composes to match the written brief.

## What it is

A sweeping, cinematic main-menu overture that evokes a cold, high war over an
endless cloud sea: evocative, serious, and stirring. It is not a short gameplay
loop and is not tied to any single power. It is `44100 Hz`, stereo, 3 to 5
minutes long, up to the 300000 ms cap, must develop across its length, and must
loop cleanly under the menu. Mood and role are prescribed; the key, tempo,
structure, and instrument choices are the model's, so the case rewards
compositional creativity over instruction-following.

## Layout

| File                 | Seeded?  | Purpose                                                                                                                                                   |
| -------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test-case.toml`     | manifest | Metadata, `[audio]` (format + `packs = ["gm-lite@0.1.0"]`), `[tool]` (`music`), `[output]`, domain.                                                       |
| `specs/brief.md`     | seeded   | The self-contained brief: mood and role, length and clean loop, how the piece should develop, the instrumentation (model's choice), and the stereo image. |
| `variants/base.toml` | —        | The single default variant.                                                                                                                               |
| `prompt.hbs`         | rendered | The instruction handed to the harness (points at the brief and the tool).                                                                                 |
| `description.md`     | —        | Site-facing blurb.                                                                                                                                        |
| `README.md`          | —        | This overview.                                                                                                                                            |

## The instrument bank

The case declares `packs = ["gm-lite@0.1.0"]`, a `name@version` ref, not a
path in this repo. The audio is not committed here: the run container is
staged with that bank and nothing else, so the general-MIDI-flavoured palette
of orchestral strings, brass, and woodwinds, keys, mallets and bells, synths,
and a drum kit is already present. The brief does not prescribe which
instruments to use; that is the model's choice. Core emits the rendered
`clip.wav` and a portable `clip.mid` automatically, so neither is
manifest-declared.

## Validate

```sh
tcab prompt --test-case thunderhead-theme --version v1.0.0 --variant base
tcab seed   --test-case thunderhead-theme --version v1.0.0 --variant base --out-dir <dir>
```

`prompt` renders the instruction, catching strict-mode template and manifest
errors. `seed` writes the seeded repository so you can confirm the brief is
self-contained.
