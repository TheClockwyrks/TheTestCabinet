# Valence — v2.0.0

A **full-stack** test case: a chemistry-themed tower-defense game the model under
test builds from scratch **and** whose 2D assets — sprites, animations, particle
effects, and audio — it must produce during the run with the asset-generation
binaries on the `test-cabinet-full-stack-2d` run image's `PATH`.

This folder is the authoring source for the version. It is not itself seeded as-is; the
harness resolves it through [`test-case.toml`](test-case.toml), which declares exactly
what is seeded (the selected variant's specs and workspace), which reference views are
rendered to screenshots and seeded as visual targets, and which proofs and checks run.

- [`test-case.toml`](test-case.toml) — the manifest.
- [`specs/`](specs/) — the seeded specification, decomposed by concern, plus the
  full-stack asset-production contract ([`specs/assets.md`](specs/assets.md)) and the
  proof-of-implementation spec ([`specs/proof.md`](specs/proof.md)). The single
  Containment campaign start is folded into the common
  [`specs/gameplay.md`](specs/gameplay.md) (the economy, integrity, the rounds,
  scoring, and the key behaviors); the game states, the menus, the HUD, and what is
  out of scope are in [`specs/ui.md`](specs/ui.md).
- [`prompt.hbs`](prompt.hbs) — the rendered build instruction.
- [`reference/`](reference/) — the harness-side visual mockups (source is not seeded;
  the rendered screenshots are).
- [`variants/`](variants/) — the `base` variant.
- [`workspaces/base/`](workspaces/base/) — the starter project seeded at the run root.

See the authoring guide under
`apps/docs/src/content/docs/guides/authoring/authoring-a-full-stack-test-case.md` and
the full-stack testing docs under `apps/docs/src/content/docs/testing/full-stack/`.
