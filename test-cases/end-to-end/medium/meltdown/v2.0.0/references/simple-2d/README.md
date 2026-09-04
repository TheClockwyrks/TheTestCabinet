# Meltdown — reference implementation (`simple-2d`)

SCAFFOLD. The reference stage writes this build; the directory exists now so the
manifest resolves.

This is the authored correct build of Meltdown under the `simple-2d` engine, named by
`variants/base.toml`'s `[reference_implementation]`. It is never seeded into a
run: it is the answer, built with the case's own `[build]` commands, held to the
same four `[toolchain]` gates a run is, and driven by `tcab capture-baselines` to
produce the baseline half of this engine's validation media under
`validation-baseline/simple-2d/base/`.

With one variant it carries its `src/` directly, so there is no per-variant level
below this one.
