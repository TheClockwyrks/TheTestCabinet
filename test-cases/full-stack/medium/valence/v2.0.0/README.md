# Valence — `v2.0.0`

**Valence** is a full-stack test case: a chemistry-themed tower-defense game the
model under test builds from scratch, and whose 2D assets it must produce during
the run. The assets are sprites, animations, particle effects, and audio, made
with the asset-generation binaries on the `test-cabinet-full-stack-2d` run
image's `PATH`.

This folder is the authoring source for the version. The harness resolves it
through [`test-case.toml`](test-case.toml), which declares what is seeded (the
selected variant's specs and workspace) and which checks run.

- [`test-case.toml`](test-case.toml) — the manifest.
- [`specs/`](specs/) — the seeded specification, decomposed by concern.
  [`specs/assets.md`](specs/assets.md) is the full-stack asset-production
  contract. [`specs/gameplay.md`](specs/gameplay.md) carries the single
  Containment campaign start, the economy, integrity, the rounds, scoring, and
  the key behaviors. [`specs/ui.md`](specs/ui.md) carries the game states, the
  menus, the HUD, and what is out of scope.
- [`prompt.hbs`](prompt.hbs) — the rendered build instruction.
- [`variants/`](variants/) — the `base` variant.
- [`workspaces/base/`](workspaces/base/) — the starter project seeded at the
  run root.

See the authoring guide under
`apps/docs/src/content/docs/guides/authoring/authoring-a-full-stack-test-case.md`
and the full-stack testing docs under
`apps/docs/src/content/docs/testing/full-stack/`.
