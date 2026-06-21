# Lanternjaw — reference target

`target.png` is the visual goal the regenerated sheet is scored against. It is
a 128×128 RGBA sprite sheet (a 4×4 grid of 32×32 frames), **seeded into the
run** as the target and served as-is. The review UI also slices it into the
named sequences (`[sheet.sequence]` in `test-case.toml`) and plays them as
animations.

## Source is not seeded

The target was authored as an ordered list of drawing operations in
`target.actions.json` and rendered through the **same `draw` binary** the
model uses. That source action log is **harness-side only** — it is never
seeded into a run, so a model cannot copy it. Authoring the target with the
drawing tool itself guarantees the goal is achievable within the operation
set, so fidelity scoring is fair.

## Regenerating the target

From the repository root, with the `draw` binary built (`cargo build -p
test-cabinet-draw --bin draw`):

```
target/debug/draw render \
  --actions test-cases/lanternjaw/v1.0.0/reference/target.actions.json \
  --out     test-cases/lanternjaw/v1.0.0/reference/target.png \
  --width 128 --height 128 --background transparent
```
