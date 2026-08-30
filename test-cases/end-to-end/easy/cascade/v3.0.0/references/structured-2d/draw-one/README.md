# Cascade — reference implementation (`structured-2d`, `draw-one`)

Placeholder. The authored, correct build of the **draw-one** variant on the **structured-2d**
engine lands here in the reference stage of the v3.0.0 rework.

A reference implementation is never seeded into a run. It is built with the
case's own `[build]` commands, held to the same four `[toolchain]` gates a run
is, published with `tcab publish-reference`, and driven by
`tcab capture-baselines` to synthesize the baseline half of this engine's
validation media.
