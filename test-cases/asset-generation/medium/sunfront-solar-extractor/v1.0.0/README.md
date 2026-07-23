# Sunfront Solar Extractor — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Solar Extractor** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt *and rig* a Duneforged sunlight harvester — a fanned rank of angled
solar-collector panels on a canted spine and low faceted pedestal — as an
84×72×72 opaque-voxel model using only the `voxel-anim` tool, one recorded
operation at a time.

`sunfront-solar-extractor` is the catalog slug for this case. It is one of the
`sunfront-*` Duneforged voxel roster and shares the faction's brass-and-sandstone
palette and solar-amber team accent, with a heavy solar-hot glow on the collector
panels and stored-sol core. It is the roster's economy structure: it harvests
sunlight to bank the legion's currency and produces **no units**, so its look and
motion deliberately contrast with the square, fabrication-styled spawner
foundries. There is no target model — the model builds toward the seeded brief and
is reviewed subjectively against it.

## The contract

The case does **not** prescribe a rig. It fixes only the required **animations**
declared in `test-case.toml`'s `[model]` table (no parts, joints, or keyframes ship
in the manifest) — each a `loop`ing, self-playing (`auto_play`) idle, so the
harvester cycles on its own with no caller:

- **`panel_track`** — the fan of collector panels sweeps across the sky to follow
  the sun and eases back.
- **`collector_bloom`** — the splayed panels spread wider apart and draw back
  together in a breathing bloom.
- **`sol_charge`** — the stored-sol core brightens and swells as it banks light,
  then settles back.

None of the three is an "emit": this structure never produces a unit. The model
**invents whatever parts and joints it needs** — which piece is the fixed body,
which pieces move, and where each sweeps, spreads, or swells — and authors each
animation's motion at run time with the `voxel-anim`
`define-animation`/`add-keyframe` subcommands. `rig.json` is pre-seeded with just
these three animation declarations, so the contract exists from the first
operation. The model may add its own extra parts, joints, and animations on top,
but must produce these three animations by name and must not contradict them.

## Contents

| Path             | Seeded to run? | Purpose                                                    |
| ---------------- | -------------- | ---------------------------------------------------------- |
| `specs/brief.md` | **Yes**        | The self-contained sculpting-and-rigging brief.            |
| `prompt.hbs`     | No             | Rendered into the model's prompt; not seeded.              |
| `test-case.toml` | No             | Manifest: voxel volume, tool, output, animations, review.  |
| `variants/`      | No             | One TOML file per variant (listed in `variants`).          |
| `description.md` | No             | Site blurb.                                                |
| `README.md`      | No             | This overview.                                             |
| `changelog.md`   | No             | Per-version changelog entry.                               |

A run receives the seeded brief, the `voxel-anim` binary, and a pre-seeded
`rig.json` holding the required animation declarations (so the contract exists from
the first operation; it declares no parts or joints — those are the model's to
invent). There is no target model and no operations schema — the binary's `--help`
is the contract.

## Variants

The Extractor ships three variants that sculpt the **same** harvester at three
sizes, each overriding the case's `[voxel]` volume: `base` (84×72×72, the default,
declared in `variants/base.toml`), `half` (each extent ~halved), and `double`
(each extent doubled). All three seed the common brief — rendered at the selected
variant's dimensions — and are rated on the case's single `overall` scoring
domain; they add no specs or domains of their own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-solar-extractor/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
