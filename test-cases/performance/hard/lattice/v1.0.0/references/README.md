# Lattice reference material

This directory holds the committed material the case ships **alongside the
held-out scored set** (which lives in `../cases/`, NOT here): the training
scenarios the model practices against. None of this is the answer key for the
scored run — the scored scenarios are in `../cases/` and are deliberately unseen.

## `training/` — practice scenarios (baked into the run image)

Behavior-focused labelled examples the model iterates against during the
harness session. Each `<name>/` holds a `scenario.json` and the reference
oracle's `expected.json` (the full `state` array with the per-snapshot
`fnv1a64:…` checksums, as produced by `lattice solve`). The container's
`containers/performance/Dockerfile` copies these into
`$LATTICE_HOME/training/<name>/` so the model finds them on disk; they are
**not** seeded into the run workspace and are **not** the scored set.

| Scenario                       | Exercises                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `full-line`                    | source → belt (tiers) → base inserter → `iron-gear` assembler (starved then flooded) → fast inserter → belt → sink |
| `assembler-circuit`            | the multi-input `circuit` recipe: inserters feed iron-plate + copper-cable, a third lifts circuits to a sink       |
| `inserter-backed-up`           | an inserter dropping onto a saturated express belt — it stalls holding its item and retries every tick             |
| `side-load`                    | a perpendicular belt side-loading onto a single lane of a main belt (the main source feeds only the other lane)    |
| `splitter-saturated`           | two express-fed inputs into a splitter, one output draining and one backing up — both round-robin cursors active   |
| `grid-lines-a`, `grid-lines-b` | `lattice gen` layouts spanning belt tiers, splitters, and the item table                                           |
