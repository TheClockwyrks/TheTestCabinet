# Locomotivation — test case (v1.0.0)

A **full-stack** medium test case. The model builds a ¾-overhead (Stardew
Valley-style), browser-playable arcade game — a yard worker hauling color-matched
freight across live, lethal, deterministic train tracks under a shift clock —
**and** produces every sprite,
animation, particle effect, and sound the game uses with the six asset-generation
binaries on the run image's `PATH`.

This directory is the authored definition, not a run. Its layout follows the
[full-stack authoring guide](../../../../../apps/docs/src/content/docs/guides/authoring/authoring-a-full-stack-test-case.md):

- `test-case.toml` — the manifest (type, build, specs, proofs, domains, review
  items). See [full-stack manifests](../../../../../apps/docs/src/content/docs/testing/full-stack/manifests.md).
- `specs/` — the seeded specification, decomposed by concern (`overview`, `world`,
  `character`, `cargo`, `trains`, `levels`, `flow`, `controls`, the
  `instrumentation` debug-and-automation contract, plus the full-stack `assets`
  production contract and `proof`).
- `prompt.hbs` — the per-run build instruction (the standing full-stack quality
  preamble is auto-prepended by the harness).
- `variants/base.toml` — the single `base` variant (the six-level campaign) and
  its `reference_implementation` pointer.
- `workspaces/base/` — the starter project seeded at the run root.
- `reference-impl/base/` — the authored, *correct* playable build, which also
  produced its own committed assets. Built with the case's `[build]` commands and
  shown on the case's "Reference" tab; never seeded into a run. It carries a
  headless **simulation mode** under `sim/` used to balance the campaign (scripted
  routes run as fast as possible; see its README).

## Reference images (deferred)

This version deliberately declares **no `[[reference]]` views yet**. The reference
screenshots for the title, a live crossing, a bridge, and a result screen are
authored from the finished reference implementation (real screenshots), not
hand-built HTML mockups, and are wired in — with their `[[reference]]` entries —
only after the reference build has been played and the design finalized.
`specs/overview.md` mentions them as illustrative examples so the contract is
stable.
