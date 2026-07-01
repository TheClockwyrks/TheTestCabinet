---
title: "Reference controllers"
---

Foray provides a handful of **baseline controllers** to the model through the
[adversarial run-container image](/testing/adversarial/foray/architecture/#the-cli),
alongside the [`foray` CLI](/testing/adversarial/foray/architecture/#the-cli)
and the map. Their purpose is to give the model something concrete to **run and
play against locally** while it develops its own controller — a yardstick, not a
template.

Every baseline is **deliberately mediocre**. Each one has an obvious, exploitable
weakness, and none of them accounts properly for Foray's
[twist](/testing/adversarial/foray/overview/#the-twist). The point
of the case is for the model to invent a controller that **beats these
comfortably and then beats other models** — a submission that merely matches a
baseline has not done the work. The model is free to read their source; it is
expected **not** to copy it.

:::caution[They are baselines, not good play]
The references intentionally ignore parts of the ruleset — carry weight, jelly,
or defence entirely. A controller that imitates one will inherit its weakness.
Treat them as opponents to dismantle, not as a starting architecture.
:::

## What the model receives

The run image provides, under `$FORAY_HOME` (`/opt/foray`), for each baseline:

- the **readable Rust source** of the controller
  (`$FORAY_HOME/references/<name>/lib.rs`), and
- a **pre-built `.wasm` module** (`$FORAY_HOME/references/<name>.wasm`),

plus the canonical map (`$FORAY_HOME/maps/mirror-32x16.toml`) and the **controller
buildkit** (`$FORAY_HOME/buildkit` — fresh copies of `foray-core` and
`foray-controller-sdk` the model's `controller` crate path-depends on, so the
seeded workspace vendors nothing). With `foray` preinstalled on `PATH`, the model
can immediately run, e.g.:

```bash
foray simulate --red ./target/.../controller.wasm \
               --blue "$FORAY_HOME/references/greedy-raider.wasm" \
               --map "$FORAY_HOME/maps/mirror-32x16.toml" --out replay.json
```

and iterate against a known opponent. All three baselines are built from the same
[controller contract](/testing/adversarial/foray/architecture/#the-controller-contract)
the model targets, so they double as worked examples of reading `world` and
returning `action`. (The buildkit, CLI, and references are baked from this repo at
image-build time so they stay in lockstep with the engine the validator scores
with — see the run-container definition under `containers/adversarial/`.)

## The baselines

### `random` — the floor

Picks a **uniformly random legal move** for each owned agent every tick
(falling back to `Stop` when boxed in). It does not seek seeds, defend, or even
prefer crossing the border. It exists as an absolute floor: any serious
controller should beat it overwhelmingly, and a controller that *doesn't* clearly
beat `random` has a bug.

### `greedy-raider` — all offence, no sense

Sends **every** agent to forage: each one beelines (shortest path) toward the
**nearest enemy seed cache**, eats whatever it reaches, and heads home only when
it can carry no more or is boxed out. It **never defends** and **ignores carry
weight** — it happily over-loads and crawls home. Its weaknesses are the two
lessons of the case: leaving your own caches completely undefended, and turning
heavy raiders into easy tags. A competent defender shreds it.

### `border-soldier` — a token balance

A naive "balanced" strategy: it **statically** assigns one or two agents to
patrol the border and chase the nearest visible intruder, and sends the rest in
as `greedy-raider`-style foragers. It is the strongest baseline, but its role
assignment **never adapts** — it does not reinforce a collapsing defence, recall a
raider to bank before it is caught, reason about jelly, or weigh load against the
distance home. It rewards a controller that reads the match state and reallocates
its three agents dynamically.

## The canonical opponent (v1 scoring)

For v1, a run is scored on **one canonical match**: the validator builds the
model's submission to wasm, loads it as **Red**, loads the case's committed
`border-soldier` module as **Blue**, and runs that single Foray match on the fixed
`mirror-32x16` map and seed. The published `replay.json` is that match, and the
recorded outcome (`win` / `loss` / `draw` / `forfeit`, plus winner, score, ticks)
is from the submission's perspective. `border-soldier` is the canonical opponent
precisely because it is the **strongest** of the three baselines — beating it is
the bar v1 sets.

`random` and `greedy-raider` are provided under `$FORAY_HOME/references` as local
sparring partners (run them with `foray simulate` as above), but they are **not**
the scored opponent.
Cross-model **round-robin / bracket tournaments** — the field-wide
[standings](/testing/adversarial/evaluation/#standings) the test-type evaluation
describes — are a **planned future step** and are out of scope for v1: the match
[`structure`](/testing/adversarial/manifests/) is still recorded faithfully in the
manifest, but the validator only runs the one canonical match against the
committed baseline.

## Why none of them is good

The three baselines span the obvious failure space on purpose — pure noise
(`random`), pure greed (`greedy-raider`), and rigid role-splitting
(`border-soldier`) — so the model can see *what losing looks like* from three
directions without being handed a winning shape. The interesting strategy space —
balancing offence against defence tick by tick, timing a bank against carry
weight, and spending jelly to run a heavy load home — is left **entirely** for the
model to discover.
