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

This is the only declaration a case needs to run in the
[`test-cabinet-full-stack-2d`](/testing/full-stack/overview/) image with the six
asset-generation binaries on `PATH`. The image is selected by the type rather
than by a manifest key.

## `[build]`

A full-stack case builds a static site through the same fixed build interface,
so the `[build]` table is required with the same `install` and `build` commands
and the same rules as an end-to-end build: both stated, neither empty, emitting
the static site into `dist/`, `build/`, or `out/`. Resolution rejects a
`build.module` path, which belongs to the wasm-artifact types.

## `packages`

The `packages` key names the repo's shippable `@test-cabinet/*` runtime
libraries the build imports as ordinary dependencies. It is valid on an
end-to-end, full-stack, or game-jam case. The same shipped-`package.json`
`file:` contract and `npm install`-at-`init` rules apply as for an
[end-to-end case](/testing/end-to-end/manifests/).

Its most common use here is
[`@test-cabinet/particle-runtime`](/testing/asset-generation/particle-binaries/),
so a game can play a particle `system.json` the model itself produced during the
run:

```toml
packages = ["@test-cabinet/particle-runtime"]
```

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
emits, while a full-stack run emits as many clips as its game needs. A
[frozen](/development/frozen-versions/) version that carries no `[audio]` table
receives the four packs it was authored against.

Order decides defaults. The model writes its own tool config during the run and
usually names no pack, and a config that names none plays the first declared
pack of its kind. Listing `combat-core` ahead of any other sample pack and
`gm-lite` ahead of any other instrument bank therefore fixes what an unqualified
`sfx-sample` or `music` invocation plays.

`scripts/ci/audio-packs-check.mjs` requires the declaration and resolves every
ref against `containers/sample-packs/` on the commit hook and in CI, and prints
the defaults each version's order resolves to.

## Forbidden asset-generation tables

A full-stack case produces its assets at run time with the on-`PATH` binaries,
so it declares no asset to generate. Resolution rejects the whole
asset-generation-only surface, exactly as it does on an end-to-end case:

- the `asset_kind` key and the `[sheet]` table;
- `[canvas]`, `[tool]`, and `[output]`;
- `[voxel]`, `[model]`, `[ui]`, `[material]`, and `[particle]`.

What a full-stack case says about its produced assets belongs in its specs:
what the program needs, and to what bar. The
[quality directive](/testing/full-stack/overview/) prepended to every full-stack
prompt already tells the model to use the binaries and to hold the assets to the
code's bar.
