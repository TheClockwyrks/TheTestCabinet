---
title: Manifests
---

A full-stack test case declares its contents in a `test-case.toml` manifest in
the version folder, exactly as an [end-to-end](/testing/end-to-end/manifests/)
case does. A full-stack case is **validated identically to an end-to-end case** —
same required tables, same fields, same rules — with one manifest difference (its
`type`) and one set of tables that becomes forbidden. Rather than repeat the
whole schema, this page points at the end-to-end manifest doc for every shared
field and documents **only the differences**.

**Read [End to End → Manifests](/testing/end-to-end/manifests/) first.** Every
field it describes — `slug`, `name`, `difficulty`, `tags`, `summary`,
`description`, `changelog`, `prompt`, `max_runtime_hours`, `workspace`, `init`,
the **required** `[build]` table, `variants`, and the `[[spec]]`,
`[[reference]]`, `[[proof]]`, `[[check]]`, `[[review_item]]`, and `[[domain]]`
tables — works the same on a full-stack case and is not restated here.

## `type = "full-stack"`

The one manifest field that identifies the type. An end-to-end case omits `type`
(or sets `type = "end-to-end"`); a full-stack case sets it explicitly:

```toml
type = "full-stack"          # selects the full-stack type (and the full-stack-2d run image)
```

This is the only declaration a case needs to run in the
[`test-cabinet-full-stack-2d`](/testing/full-stack/overview/#the-full-stack-2d-run-image)
image with the six asset-generation binaries on `PATH`; the image is selected by
the type, not by any manifest key.

## `[build]` is required, like end-to-end

A full-stack case builds a static site through the same [fixed build
interface](/testing/end-to-end/overview/#design-requirements), so the `[build]`
table is **required** with the same `install` and `build` commands and the same
rules as an [end-to-end build](/testing/end-to-end/manifests/) — both stated
explicitly, neither empty, emitting the static site into `dist/`, `build/`, or
`out/`. A `build.module` path is rejected here just as it is for end-to-end (that
field belongs to the wasm-artifact types).

## `packages`

The [`packages`](/testing/end-to-end/manifests/) key works exactly as it does for
an end-to-end case and is **allowed** on a full-stack case (the two types are the
only ones that may declare it). It names the repo's shippable
`@test-cabinet/*` runtime libraries the build imports as ordinary dependencies,
and the same shipped-`package.json` `file:` contract and `npm install`-at-`init`
rules apply.

Its most common use here is
[`@test-cabinet/particle-runtime`](/testing/asset-generation/particle-binaries/),
so a game can **play a particle `system.json` the model itself produced** during
the run, through the runtime's `./canvas` binding:

```toml
packages = ["@test-cabinet/particle-runtime"]
```

See [Produced assets are build
inputs](/testing/full-stack/overview/#produced-assets-are-build-inputs) for how
the produced `system.json` is consumed, and
[Packages](/testing/end-to-end/overview/#packages) for the full model-facing
contract.

## Asset-generation tables are forbidden

A full-stack case produces its assets **at run time using the on-`PATH`
binaries**, not by declaring an asset to generate. It is a playable-program case,
not an [asset-generation](/testing/asset-generation/manifests/) one, so all of
the asset-generation-only manifest surface is **rejected at resolution** — the
same way it is on an end-to-end case:

- The `asset_kind` key (a full-stack case has no single asset kind — it produces
  many, of different kinds), and the **`[sheet]`** table.
- **`[canvas]`**, **`[tool]`**, and **`[output]`** — the drawing-tool and output
  tables.
- **`[voxel]`**, **`[ui]`**, **`[material]`**, **`[particle]`**, and
  **`[audio]`** — the per-asset-kind tables (the full-stack-2d image ships no
  voxel/mesh/skinned/`ui`/`material` tools at all).

Declaring any of these on a full-stack case is a mistake worth catching, so it is
rejected rather than silently ignored. Everything a full-stack case needs to
say about its produced assets belongs in its **specs** (what the program needs
and to what bar), not in a manifest table — the [quality
directive](/testing/full-stack/overview/#the-standing-quality-directive) prepended
to the prompt already tells the model to use the binaries and hold the assets to
the code's bar.
