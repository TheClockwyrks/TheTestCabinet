---
title: Author a Particle Test Case
---

## Overview

Scaffold a particle asset-generation case: a visual effect the model authors as
a system of emitters, forces and per-particle curves with the `particle-2d` or
`particle-3d` binary, simulated live against a written brief.
[Particle cases](/testing/asset-generation/manifests/particle-cases/) is the
authoritative manifest schema, and
[Authoring a Particle Test Case](/guides/authoring/authoring-a-particle-test-case/)
is the full procedure.

## Layout

A version lives at `test-cases/<type>/<difficulty>/<slug>/<version>/` and is
frozen once a run references it. Revise by adding a new version.

```text
test-cases/asset-generation/<difficulty>/<slug>/<version>/
  test-case.toml    # type, asset_kind, [particle], [tool], [output], the overall domain
  variants/         # one standalone TOML file per variant, listed in `variants`
  prompt.hbs        # rendered into the harness instruction; not seeded
  specs/brief.md    # the effect and how the binary behaves; seeded
  description.md    # site-facing summary; not seeded
  changelog.md      # what changed in this version; not seeded
```

A run receives the seeded brief plus the orchestrator-written
`particle-2d.config.json` or `particle-3d.config.json`. The case declares no
`[[reference]]`, `[build]`, `[[check]]`, or `[[review_item]]`.

## Steps

1. Pick the kind and the effect. `particle-2d` authors a planar field, worked
   example `spectra-burst`; `particle-3d` authors a volume, worked example
   `thunderhead-flak`. Choose one self-contained moment whose character reads
   the same across repeated simulations.
2. Write `specs/brief.md`. State what the effect depicts, its lifecycle and
   timing within `duration_ms`, its emitters and forces as intent, its
   color, opacity and size curves, the exact palette as named hex values, and
   whether it is one-shot or looping. State that `render` simulates the system
   and emits `system.json`, and that a stochastic simulation varies slightly
   between plays. Keep the brief
   [self-contained](/testing/end-to-end/overview/#self-contained-specifications):
   the model sees only the seeded files, and the binary's `--help` is the
   operation vocabulary.
3. Write `prompt.hbs` from the documented template variables (`{{workspace}}`,
   `{{variant.*}}`, `{{#each specs}}`). Rendering is strict, so an unknown
   variable is an error. Point the model at the binary's `--help`, and require
   it to author a system and run `render` before finishing.
4. Write `test-case.toml`:
   - the site-facing metadata (`name`, `difficulty`, `tags`, `summary`,
     `description`, `changelog`), `prompt`, `max_runtime_hours`, and
     `type = "asset-generation"`;
   - `asset_kind = "particle-2d"` or `"particle-3d"`;
   - `variants`, a list of paths to the files under `variants/`. It is a root
     key, so it precedes the first table header, and its first entry is the
     default;
   - `[particle]` with `width`, `height`, `duration_ms` and `fps` all greater
     than zero, plus `depth` for `particle-3d` only, `loop`, and `background`;
   - `[tool]` naming the `binary` and the `preview` path, and `[output]` naming
     the `actions` log. Core emits `system.json` automatically;
   - one `[[domain]]` with `id = "overall"`, the single rating the produced
     effect is judged on.
5. Write each variant file under `variants/`, giving it a `slug`, a `name`, a
   `description`, and any additive `spec` entries.

## Validate

Run both commands for every variant.

```sh
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

`prompt` catches template and manifest errors. `seed` writes the seeded
repository under `tmp/`, so you can confirm the seeded set is self-contained.

## Next steps

- [Run a Test Case](/quickstarts/development/run-a-test-case/) exercises the
  case end to end.
- [Review a Run](/quickstarts/development/review-a-run/) plays the emitted
  system live and rates it.
