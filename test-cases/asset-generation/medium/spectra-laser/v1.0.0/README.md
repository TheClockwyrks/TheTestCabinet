# Spectra Laser — `v1.0.0`

This is version `v1.0.0` of the **Spectra Laser** test case: an audio
asset-generation case (`asset_kind = "sfx-synth"`) that asks a model to
synthesize the player fighter's laser-fire sound effect for _Spectra_, a
two-band formation shooter, using only the `sfx-synth` binary, one recorded
operation at a time.

`spectra-laser` is a sibling of the `spectra-fighter` sprite case in the same
_Spectra_ game universe: that case draws the ship, this one voices its gun.

## What the model builds

- A sound effect synthesized from oscillators and noise alone. The case names no
  sample pack and no instrument bank.
- A crisp, synthetic laser blip: a sharp transient attack, a fast downward pitch
  sweep, and a quick decay to silence, energetic and arcade-retro.
- Output format (`[audio]`): mono, 44.1 kHz, capped at 800 ms. The sound itself
  runs far shorter, roughly 120–250 ms.

The `sfx-synth` binary records every operation to `actions.json` and, on the
`render` command, mixes the clip down to `clip.wav` and draws a waveform and
spectrogram preview. The recorded action log is the authoritative output, and
core re-renders the `.wav` from it. There is no target clip: the model builds to
match the brief, and a human reviews the result against it.

## Layout

| File                 | Seeded? | Purpose                                                                         |
| -------------------- | ------- | ------------------------------------------------------------------------------- |
| `test-case.toml`     | —       | Manifest: metadata, `asset_kind`, `[audio]`/`[tool]`/`[output]`, domain.        |
| `prompt.hbs`         | —       | The instruction rendered per run (points at the brief, the tool, and `render`). |
| `specs/brief.md`     | yes     | The self-contained synthesis brief — character, envelope, synth graph, format.  |
| `variants/base.toml` | —       | The single default variant (`base`).                                            |
| `description.md`     | —       | Site-facing blurb.                                                              |
| `README.md`          | —       | This overview.                                                                  |

Only `specs/brief.md` reaches a run, alongside the pre-seeded `sfx-synth` config
the binary writes into. Everything else is authoring- or site-side only.

## Variants

- `base` — the default and only variant; builds toward the common brief with no
  additive constraints.

## Validate

```sh
tcab prompt --test-case spectra-laser --version v1.0.0 --variant base
tcab seed   --test-case spectra-laser --version v1.0.0 --variant base --out-dir <dir>
```
