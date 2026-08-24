# Orrery — case version v1.0.0

The machine-building puzzle case: an Opus-Magnum-inspired, celestially
redecorated game of arms, sigils, and looping tapes on a bounded hex field,
built from a self-contained specification under `specs/`.

For humans working on this case:

- `test-case.toml` is the manifest: seeded specs, engines, workspaces, build
  and toolchain commands, the `__orrery` instrumentation handle, the scoring
  domains, and the full reviewer checklist. Checklist items carry no
  `validation` scripts yet; the manifest's `[review]` comment states the
  intended shape of the suites.
- `specs/` is the seeded specification. `simulation.md` is the heart
  (simultaneous motion, the torn rule, sampled collision with worked
  examples, the sigil pipeline, metrics); `challenges.md` fixes the ten
  Extras; `modes/campaign.md` obliges the build to design its own course and
  ship reference solutions for every challenge, Extras included, exposed via
  `challengeSolution` on the debug surface.
- The collision examples' distances were computed, not eyeballed: sampled
  sweep at `t = k/8`, `HEX_PITCH` 48, threshold `2 * MOTE_COLLIDE_R` = 38.
  If you change any of those constants, recompute every example.
- `workspaces/` holds the two starter projects (`none` and `simple-2d`),
  mirroring Refract's. `references/` and `validation/` do not exist yet;
  `variants/base.toml` documents that the `[reference_implementation]` table
  is added when the reference builds land.

The case deliberately fixes interaction geometry (field, tray slots, tape
cells) and no appearance, so validators can drive the editor through emulated
input while every build looks like its own game.
