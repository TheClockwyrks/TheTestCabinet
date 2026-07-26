# Thunderhead Broadside — v1.0.0

An **audio** asset-generation test case (`asset_kind = "sfx-sample"`). The model
authors one short **stereo** sound effect — a capital-ship main-gun broadside for
*Thunderhead*, a naval fleet-command game — through the `sfx-sample` audio binary,
one recorded operation at a time, to match a written brief. There is **no target
clip**: the case is human-reviewed against `specs/brief.md`.

## What the model builds

A heavy, layered naval-gun report, no longer than **4000 ms**: a percussive
concussion transient, a deep sub boom body, a metallic barrel ring, and a
rubble/debris tail, composited from library clips into one four-second event with a
deliberate stereo image. See `specs/brief.md` for the full brief.

## The sample pack

The `[audio]` table names `sample_pack = "combat-core@0.1.0"` — the baked
[sample library](../../../apps/docs/src/content/docs/testing/asset-generation/audio-binaries.md)
the model layers over. This is a `name@version` baked into the run-container image
at build time (the manifest lives at `containers/sample-packs/combat-core.toml`),
**not** a path in this repo; the run is scheduled onto the image carrying that pack,
and the model browses it at run time with `sfx-sample list-samples` /
`sfx-sample sample-info`. The brief points at real pack samples (e.g.
`cannon_body_heavy`, `boom_sub_rumble`, `impact_metal_dry`, `impact_metal_hollow`,
`clang_metal`, `debris_rubble`) as ingredients to composite.

## Files

| File | Seeded? | Purpose |
| --- | --- | --- |
| `test-case.toml` | — | Manifest: type, `asset_kind`, `[audio]`, `[tool]`, `[output]`, domain. |
| `prompt.hbs` | rendered | The instruction handed to the harness (points at the brief and the tool). |
| `specs/brief.md` | **yes** | The brief — the only content the model receives. |
| `variants/base.toml` | — | The single default variant. |
| `description.md` | no | Site-facing blurb. |
| `README.md` | no | This human overview. |

Only `specs/brief.md` reaches a run (plus the seeded `sfx-sample.config.json` the
binary writes into, and the baked `combat-core` library on the image). Everything
else is authoring- or site-side.

## Validate

```sh
tcab prompt --test-case thunderhead-broadside --version v1.0.0 --variant base
tcab seed   --test-case thunderhead-broadside --version v1.0.0 --variant base --out-dir <dir>
```
