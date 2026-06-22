# Sandbox and limits

Your controller is arbitrary code running in a competitive setting, so the host
contains it completely. Every invocation runs inside a wasm sandbox with hard
per-tick limits. Staying inside them is part of playing well — a controller that
is too slow, too memory-hungry, or that crashes does not stall the match, it
**forfeits** it.

## Per-tick limits

The host applies these to **every** call to your `tick` entry, every tick:

| Limit | Shipped value | On exceeding |
| --- | --- | --- |
| **Fuel** (wasmtime fuel per tick) | **50,000,000** | disqualifying forfeit |
| **Memory** (linear-memory cap) | **64 MiB** (`67,108,864` bytes) | disqualifying forfeit |

- **Fuel** is a ceiling on the amount of work your controller may do in a single
  tick. It is generous — a per-tick BFS over the `32 × 16` board costs only a few
  hundred thousand to a few million fuel, and a competent controller that runs
  several per tick (pathfinding, avoiding a camped defender, assigning roles) peaks
  around ten million, comfortably under the ceiling — but it is a **hard** ceiling:
  a controller that exhausts its fuel on a tick is disqualified for the match, not
  paused. Do not run unbounded search per tick. You can feel out your own
  per-tick cost: the `foray` CLI prints each controller's peak fuel against the
  ceiling, and raising `--fuel-per-tick` lets you see how far over budget an
  over-the-limit controller actually runs.
- **Memory** caps your module's linear memory. You may keep working state across
  ticks (the instance is reused — see `specs/contract.md`), but the total must stay
  under the cap. Growing memory without bound is a forfeit.

## What counts as a forfeit

Any of these loses the current match outright (the opponent wins by forfeit), and
the match still produces a replay:

- **Exhausting fuel** on a tick.
- **Exceeding the memory cap.**
- **Trapping** — a wasm trap, a Rust panic that unwinds to a trap, an out-of-bounds
  access, an integer divide-by-zero, etc.
- **Returning a contract-invalid action** — see the schema-invalid tier in
  `specs/contract.md` (missing `moves`, an unowned/duplicated/omitted agent, an
  unknown `dir`, malformed JSON).
- **Failing to load** — the build produced no module, or the module does not export
  the `tick` contract entry, or it cannot be instantiated. This is recorded as a
  forfeit loss before the match even starts.

A **blocked move** (into a wall, off the board, or for a stalled laden raider) is
**not** a forfeit — it is clamped to `Stop`. Only illegal *intent* and runtime
misbehaviour forfeit; ordinary navigation bugs just cost tempo.

## Practical guidance

- Keep `tick` **cheap and bounded**: do per-tick work proportional to the board
  size, not an open-ended search. The board is small; a BFS or two per agent is
  comfortably affordable.
- Use module state for anything expensive you can compute once and carry forward,
  but keep its size bounded.
- Never `unwrap()` on data derived from the observation in a way that could panic
  on a legal-but-unexpected state; a panic is a forfeit. The SDK's decode path
  already falls back to a legal all-`Stop` action on a malformed observation rather
  than trapping.
