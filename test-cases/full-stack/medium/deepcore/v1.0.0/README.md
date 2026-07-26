# Deepcore — v1.0.0

A **full-stack** test case: a Motherload-style subterranean **dig-and-build** game the
model under test builds from scratch **and** whose 2D assets — sprites, the animated
miner character, particle effects, and audio — it must produce during the run with the
asset-generation binaries on the `test-cabinet-full-stack-2d` run image's `PATH`.

This folder is the authoring source for the version. It is not itself seeded as-is; the
harness resolves it through [`test-case.toml`](test-case.toml), which declares exactly
what is seeded (the selected variant's specs and workspace), which reference views are
rendered to screenshots and seeded as visual targets, and which proofs and checks run.

- [`test-case.toml`](test-case.toml) — the manifest.
- [`specs/`](specs/) — the seeded specification, decomposed by concern, plus the
  full-stack asset-production contract ([`specs/assets.md`](specs/assets.md), whose
  animated-miner section is the headline) and the proof-of-implementation spec
  ([`specs/proof.md`](specs/proof.md)).
- [`prompt.hbs`](prompt.hbs) — the rendered build instruction.
- [`reference/`](reference/) — the visual reference screenshots, captured from the
  reference-impl build and seeded as visual targets.
- [`variants/`](variants/) — the single `base` variant. The Standard/Hardcore mode is
  an in-game menu (it changes only what happens on death), not a variant.
- [`workspaces/base/`](workspaces/base/) — the starter project seeded at the run root.

See the authoring guide under
`apps/docs/src/content/docs/guides/authoring/authoring-a-full-stack-test-case.md` and
the full-stack testing docs under `apps/docs/src/content/docs/testing/full-stack/`.
