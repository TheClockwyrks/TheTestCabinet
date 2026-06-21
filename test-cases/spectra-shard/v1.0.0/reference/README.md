# Spectra Shard — reference target

`target.png` is the visual goal the regenerated sprite is scored against. It
is a 64×64 RGBA image, **seeded into the run** as the target and served as-is.

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
  --actions test-cases/spectra-shard/v1.0.0/reference/target.actions.json \
  --out     test-cases/spectra-shard/v1.0.0/reference/target.png \
  --width 64 --height 64 --background transparent
```
