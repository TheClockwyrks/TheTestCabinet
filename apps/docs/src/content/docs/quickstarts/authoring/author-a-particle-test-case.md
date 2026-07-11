---
title: Author a Particle Test Case
---

Scaffold a new [particle](/testing/asset-generation/particle-binaries/)
[asset-generation](/testing/asset-generation/overview/) test case — a visual effect
(an explosion, a muzzle flash, an engine plume) the model **authors as a system**
(emitters, forces, per-particle F-curves) with the `particle-2d` or `particle-3d`
binary, simulated live to match a written brief. This is the short version;
[Authoring a Particle Test Case](/guides/authoring/authoring-a-particle-test-case/)
covers it in full, and [Manifests](/testing/asset-generation/manifests/) is the
authoritative schema.

Building a playable game instead? See
[Author an End-to-End Test Case](/quickstarts/authoring/author-an-end-to-end-test-case/) —
a different test type with a `[build]` and reference mockups.

## Layout

A version lives at `test-cases/<type>/<difficulty>/<slug>/<version>/` and is **immutable** once runs
reference it — revise by adding a new version, not by editing a published one.

```text
test-cases/<type>/<difficulty>/<slug>/<version>/
  test-case.toml         # manifest: type, asset_kind, particle, tool, output, domains
  variants/              # one standalone TOML file per variant (listed in `variants`)
  prompt.hbs             # rendered into the harness instruction (NOT seeded)
  specs/brief.md         # the effect + how the tool behaves — SEEDED
```

There is **no target clip**, **no simulation seed**, and **no bake** — the model
authors a system to match the brief, not to reproduce a supplied effect, and it is
reviewed by a human simulating it live.

## Steps

1. Choose the kind and subject: **`particle-2d`** (planar, screen-space — width and
   height; worked example **`spectra-burst`**) or **`particle-3d`** (volumetric —
   width, height, depth; worked example **`thunderhead-flak`**, the primary manifest
   example). Pick a self-contained VFX moment whose *character* reads the same across
   live replays.
2. Write `specs/brief.md`: what the effect depicts and its silhouette; its lifecycle
   and timing over `duration_ms`; the emitters and forces conceptually (as intent,
   not flags); the color/opacity/size curves; the **exact palette** (named hex, the
   only colors allowed); **one-shot vs loop**; and how the tool behaves — that
   `render` simulates the system and emits `system.json`, and the effect **varies
   slightly from play to play**. Keep it
   [self-contained](/testing/end-to-end/overview/#self-contained-specifications) —
   the model sees only the seeded files. There is **no operations schema**.
3. Write `prompt.hbs` using only the documented template variables
   (`{{variant.*}}`, `{{#each specs}}`) — it renders in strict mode — pointing the
   model at the binary's `--help` and requiring it to author a *system* (not
   individual particles) and run `render` before finishing.
4. Write `test-case.toml`: metadata (`name`, `difficulty`, `tags`),
   `type = "asset-generation"`, `asset_kind` (`"particle-2d"` or `"particle-3d"`), a
   `variants` list of paths to standalone variant files under `variants/` (a root
   key, so it must precede the first table header; first = default), a `[particle]`
   table (`width`/`height`, plus `depth` for 3D only, `duration_ms`, `fps` > 0,
   `loop`, `background` — it replaces `[canvas]`/`[voxel]`), `[tool]` (the `binary`
   and `preview` path), `[output]` (only `actions` — core emits `system.json`
   automatically), and the `[[domain]]`/`[[review_item]]`s a human reviews the
   simulated effect under. The case declares **no `[[reference]]`**, **no `[model]`**,
   **no `[build]`**, and **no `[[check]]`**; a review item carries only a `domain`
   (an added `reference` is rejected — there is no target).

[Authoring a Particle Test Case](/guides/authoring/authoring-a-particle-test-case/)
is the full procedure — read it before you start, alongside the worked example
matching your kind.

## Validate

```sh
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

Render the prompt and inspect the seeded repository to confirm the manifest resolves
and the seeded set (brief + the seeded `particle-3d.config.json` /
`particle-2d.config.json`) is self-contained. Do this for **every** variant.

## Next steps

- [Run a Test Case](/quickstarts/development/run-a-test-case/) to exercise it end to end.
- [Review a Run](/quickstarts/development/review-a-run/) to assess a run, playing the
  emitted system live in the review UI.
