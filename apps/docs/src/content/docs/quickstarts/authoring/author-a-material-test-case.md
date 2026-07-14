---
title: Author a Material Test Case
---

Scaffold a new [asset-generation](/testing/asset-generation/overview/) test case for a
tileable **PBR material** (`asset_kind = "material"`) — a set of seamless maps the model
authors with the `texture` painter and the companion `pbr` binary (bake normal/AO, set
uniforms, assemble `material.json`, render the lit preview) to match a brief. This is the
short version;
[Authoring a Material Test Case](/guides/authoring/authoring-a-material-test-case/)
covers it in full, and [Manifests](/testing/asset-generation/manifests/) is the
authoritative schema.

Painting a high-res 2D image instead of a tileable surface? See
[Author a UI Test Case](/quickstarts/authoring/author-a-ui-test-case/).

## Layout

A version lives at `test-cases/<type>/<difficulty>/<slug>/<version>/` and is **immutable** once runs
reference it — revise by adding a new version, not by editing a published one.

```text
test-cases/<type>/<difficulty>/<slug>/<version>/
  test-case.toml         # manifest: type, asset_kind, material, tool, output, domains
  variants/              # one standalone TOML file per variant (listed in `variants`)
  prompt.hbs             # rendered into the harness instruction (NOT seeded)
  specs/brief.md         # the surface + which maps to emit + how the tools behave — SEEDED
```

A run receives only the seeded brief plus the orchestrator-written
`material.config.json` (map size, declared channels, tiling, log paths). There is **no
target image** and **no `reference/` directory**; `description.md` and `README.md` are
**NOT seeded**.

## Steps

1. Pick a catalog **slug** and a **tileable surface** — "weathered volcanic basalt," not
   "a rock." It must read as a repeating surface at a declared tile scale and exercise
   every map you emit.
2. Write `specs/brief.md`: the surface and its mesoscale structure, that it must **tile
   seamlessly**, the **tiling-scale intent** in real terms, the **exact palette** (hex
   values), and **which maps to emit and what each encodes**. Fold in how `texture` +
   `pbr` behave and the **height-to-normal/AO bake workflow** (paint relief into the
   grayscale `height` aid, bake `normal`/`ao` from it). Keep it
   [self-contained](/testing/end-to-end/overview/#self-contained-specifications) — there
   is **no operations schema**; each binary's `--help` is the contract.
3. Write `prompt.hbs` using only the documented template variables (`{{variant.*}}`,
   `{{#each specs}}`) — it renders in strict mode — and point the model at
   `texture --help` / `pbr --help`.
4. Write `test-case.toml`: metadata, `type = "asset-generation"` (omitting it defaults to
   end-to-end, which rejects the tables below), `asset_kind = "material"`, a `variants`
   list (a root key; first = default), and:
   - `[material]` — `size` (a **power of two**), `tile = true`, and `maps` (**must
     include `base-color`**; the rest any subset of `normal`, `roughness`, `metallic`,
     `ao`, `emissive`). Do **not** list `height` — an authoring aid, not emitted. **No
     `[model]`.**
   - `[tool]` — `binary = "texture"` (`pbr` is on `PATH` in the same image) and
     `preview = "maps/{map}.png"` (the `{map}` template).
   - `[output]` — `actions = "actions.json"`, a single interleaved log (**not** a `{map}`
     template; each op carries `--map`). Core emits the per-map PNGs and `material.json`
     automatically — neither is declared.
   - `[[domain]]`s plus `[[review_item]]`s (reporter-side, NOT seeded; each carries only a
     `domain` — **no `reference`**). **No `[[reference]]`, `[build]`, or `[[check]]`** —
     resolution rejects them.

[Authoring a Material Test Case](/guides/authoring/authoring-a-material-test-case/) is the
full procedure. The worked example is `caldera-basalt`.

## Validate

```sh
tcab prompt --test-case caldera-basalt --version v1.0.0 --variant base
tcab seed   --test-case caldera-basalt --version v1.0.0 --variant base
```

For **every** variant: `prompt` renders the instruction (catching strict-mode template
errors and manifest problems — a missing `type`, a `[material]` without `base-color`, a
`size` that is not a power of two); `seed` writes the seeded repository so you can confirm
it is self-contained. Re-ingesting an already-ingested case must be **forced**.

## Next steps

- [Run a Test Case](/quickstarts/development/run-a-test-case/) to exercise it end to end,
  then read the emitted `maps/`, `material.json`, and the `pbr` preview.
- [Review a Run](/quickstarts/development/review-a-run/) to judge the material per map, as
  a 2x2 tiling, and on the lit preview surface.
