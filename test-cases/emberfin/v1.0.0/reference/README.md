# Emberfin — reference targets

`frames/<index>.png` are the per-frame visual goals the regenerated sheet is
scored against — one **32×32 RGBA** image per declared `[[sheet.frame]]` in
`test-case.toml`. Each is **seeded into the run** as that frame's target and
served as-is. The review UI plays the named sequences (`[[sheet.sequence]]`)
from these per-frame images as animations, and scores each frame independently
(there is no whole-sheet aggregate).

## Source is not seeded

Each frame was authored as an ordered list of drawing operations in
`frames/<index>.actions.json` and rendered through the **same drawing library**
`draw-sheet` and the validator use. Those source action logs are
**harness-side only** — they are never seeded into a run, so a model cannot copy
them. Authoring each target with the drawing tool itself guarantees the goal is
achievable within the operation set, so fidelity scoring is fair.

## Regenerating a target

From the repository root, with the `draw` binary built (`cargo build -p
test-cabinet-draw --bin draw`), render one frame's log to its target (each
frame is its own 32×32 image):

```
target/debug/draw render \
  --actions test-cases/emberfin/v1.0.0/reference/frames/0.actions.json \
  --out     test-cases/emberfin/v1.0.0/reference/frames/0.png \
  --width 32 --height 32 --background transparent
```
