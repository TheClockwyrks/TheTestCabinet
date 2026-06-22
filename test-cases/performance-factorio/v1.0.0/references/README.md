# Lattice reference material

This directory holds the committed material the case ships **alongside the
held-out scored set** (which lives in `../cases/`, NOT here): the training
scenarios the model practises against and the two worked-example reference
engines. None of this is the answer key for the scored run — the scored
scenarios are in `../cases/` and are deliberately unseen.

## `training/` — practice scenarios (baked into the run image)

Behaviour-focused labelled examples the model iterates against during the
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

## The reference engines (worked examples + the validator self-test baseline)

The two reference submission engines, each a `cdylib` compiled to a
`wasm32-unknown-unknown` core module plus a readable source copy. Both produce
the oracle's exact per-snapshot checksums on every scenario; `transport` does so
for a small fraction of `naive`'s fuel.

- `naive.wasm` / `naive/lib.rs` — the honest floor: it advances the world the
  obvious way (move every item every tick), so its fuel is the genuine
  `O(ticks × items)` cost. It is what the starter `engine` delegates to.
- `transport.wasm` / `transport/lib.rs` — the efficient baseline: it refuses to
  re-walk steady state, detecting the world's settle-into-a-cycle and
  fast-forwarding across whole cycles. Same checksums, far less fuel.

These are committed so `core`'s `PerformanceValidator` self-test can score
`transport.wasm` as a submission against a committed scenario+expected and
assert a correct, low fuel result, and as the worked examples baked into the run
image under `$LATTICE_HOME/references/`. They are not a scoring opponent — a
performance run scores the submission against the reference _checksums_ (in
`../cases/*.out`), not against another wasm module.
