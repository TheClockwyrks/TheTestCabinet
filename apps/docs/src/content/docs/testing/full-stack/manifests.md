---
title: Manifests
---

A full-stack test case declares its contents in a `test-case.toml` manifest in
the version folder and is resolved by the same rules an
[end-to-end](/testing/end-to-end/manifests/) case is: the same required tables,
the same fields, the same validation. This page documents the differences.

Read [End to End → Manifests](/testing/end-to-end/manifests/) first. Every field
it describes behaves identically on a full-stack case: `slug`, `name`,
`difficulty`, `tags`, `summary`, `description`, `changelog`, `prompt`,
`max_runtime_hours`, `experimental`, `workspace`, `init`, the required `[build]`
table, `variants`, `[instrumentation]`, and the `[[spec]]`, `[[reference]]`,
`[[proof]]`, `[[check]]`, `[[review_item]]`, and `[[domain]]` tables. The
reviewer checklist may equally use the categories grammar (`[review] format = 2`)
in place of `[[review_item]]`.

## `type = "full-stack"`

The `type` key is what identifies the type. An end-to-end case omits it or sets
`type = "end-to-end"`; a full-stack case sets it explicitly:

```toml
type = "full-stack"
```

The type and `asset_dimension` together select the
[run image](/testing/full-stack/overview/#the-run-image) and put that image's
asset-generation binaries on the model's `PATH`. A case that declares the type
alone runs in the 2D image with the six 2D binaries.

## `asset_dimension`

`asset_dimension` says which dimension the case's produced art is in, and so
which of the two full-stack images the run executes in:

```toml
type = "full-stack"
asset_dimension = "3d"
```

- `"2d"` is the default and selects `test-cabinet-full-stack-2d`, carrying
  `draw`, `draw-sheet`, `particle-2d`, `sfx-synth`, `sfx-sample`, and `music`.
- `"3d"` selects `test-cabinet-full-stack-3d`, which adds `voxel`, `voxel-anim`,
  and `particle-3d` to that same set.

It is a root key, so it sits above the first table header. It is a property of
the whole version rather than a per-variant choice, so every variant of a
version runs in the same image. Resolution accepts it on a full-stack case and
rejects it on every other test type.

## `[build]`

A full-stack case builds a static site through the same fixed build interface,
so the `[build]` table is required with the same `install` and `build` commands
and the same rules as an end-to-end build: both stated, neither empty, emitting
the static site into `dist/`, `build/`, or `out/`. Resolution rejects a
`build.module` path, which belongs to the wasm-artifact types.

## `packages`

The `packages` key names the repo's shippable `@clockwyrks/*` runtime
libraries the build imports as ordinary dependencies. It is valid on an
end-to-end, full-stack, or game-jam case. The same shipped-`package.json`
`file:` contract and `npm install`-at-`init` rules apply as for an
[end-to-end case](/testing/end-to-end/manifests/).

Its most common use here is
[`@clockwyrks/particle-runtime`](/testing/asset-generation/particle-binaries/),
so a game can play a particle `system.json` the model itself produced during the
run:

```toml
packages = ["@clockwyrks/particle-runtime"]
```

A `3d` case that ships a produced voxel model declares
[`@clockwyrks/voxel-runtime`](/components/voxel-runtime/overview/) the same
way, so the game can decode each part's `.glb` and pose the produced rig.

## `[audio]`

A full-stack run produces its own sound with `sfx-synth`, `sfx-sample`, and
`music`, and `[audio]` declares the audio packs those binaries may reach. The
run container is staged with the declared packs and no others, so the table is
the boundary of what `list-samples` and `list-instruments` browse. Every version
declares it, either the full published set or the subset the case needs:

```toml
[audio]
packs = [
  "combat-core@0.1.0",
  "gm-lite@0.1.0",
  "cinematic@0.1.0",
  "synthwave@0.1.0",
]
```

`packs` is the only key the table takes here. Each entry is a `name@version` ref
naming a [published pack](/testing/asset-generation/audio-binaries/#the-sample-library),
both halves required, and naming one pack twice is an error. `sample_rate`,
`channels`, and `max_duration_ms` are rejected: they fix the single clip an
[audio asset-generation case](/testing/asset-generation/manifests/audio-cases/)
emits, while a full-stack run emits as many clips as its game needs.

A version carrying no `[audio]` table at all receives a fixed set pinned in
`crates/core`: `combat-core@0.1.0`, `gm-lite@0.1.0`, `cinematic@0.1.0`, and
`synthwave@0.1.0`, in that order. The set is pinned by ref rather than read from
`containers/sample-packs/`, so publishing a pack leaves it unchanged and a
[frozen](/development/frozen-versions/) version keeps the palette it was
authored and reviewed against. `scripts/ci/audio-packs-check.mjs` requires the
table on every version that is not frozen, so a frozen version is the only thing
that reaches the pinned set.

Order decides defaults. The model writes its own tool config during the run and
usually names no pack, and a config that names none plays the first declared
pack of its kind. Listing the pack a case wants an unqualified `sfx-sample` or
`music` invocation to play ahead of the others of its kind is what fixes that.

`scripts/ci/audio-packs-check.mjs` resolves every ref against
`containers/sample-packs/` on the commit hook and in CI, and prints the defaults
each version's order resolves to.

A case's [`specs/`](/testing/full-stack/overview/) name the packs it declares,
because the packs the run holds are the packs the model may browse.

## Forbidden asset-generation tables

A full-stack case produces its assets at run time with the on-`PATH` binaries,
so it declares no asset to generate. Resolution rejects the whole
asset-generation-only surface, exactly as it does on an end-to-end case:

- the `asset_kind` key and the `[sheet]` table;
- `[canvas]`, `[tool]`, and `[output]`;
- `[voxel]`, `[model]`, `[ui]`, `[material]`, and `[particle]`.

`asset_dimension` is a full-stack key of its own, unrelated to `asset_kind`: it
picks the tooling the run carries rather than an asset to generate.

What a full-stack case says about its produced assets belongs in its specs:
what the program needs, and to what bar. The
[quality directive](/testing/full-stack/overview/) prepended to every full-stack
prompt already tells the model to use the binaries and to hold the assets to the
code's bar.
