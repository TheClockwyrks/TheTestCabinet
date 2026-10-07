---
title: "Reference controllers"
---

Foray provides three baseline controllers to the model through the adversarial
run-container image, alongside the
[`foray` CLI](/testing/adversarial/foray/architecture/#the-cli) and the map. They
give the model a concrete opponent to run and play against locally while it
develops its own controller. They are a yardstick rather than a template.

Every baseline is deliberately mediocre. Each has an obvious, exploitable
weakness, and none of them accounts for Foray's
[twist](/testing/adversarial/foray/overview/#rule-changes): no baseline ever eats
jelly, and none treats a large seed as more than a cache that happens to be under
its feet. The case asks the model to invent a controller that beats these
comfortably and then beats other models, so a submission that merely matches a
baseline has not done the work. The model may read their source and is expected
to write its own architecture.

## Provided tooling

The run image provides, under `$FORAY_HOME` (`/opt/foray`), for each baseline:

- the readable Rust source of the controller
  (`$FORAY_HOME/references/<name>/lib.rs`), and
- a pre-built module (`$FORAY_HOME/references/<name>.wasm`).

It also provides the canonical map (`$FORAY_HOME/maps/mirror-32x16.toml`) and the
controller buildkit (`$FORAY_HOME/buildkit`), which holds fresh copies of
`foray-core` and `foray-controller-sdk` that the model's `controller` crate
path-depends on, so the seeded workspace vendors nothing. With `foray` on `PATH`
the model builds and plays immediately:

```bash
cargo build --release --target wasm32-unknown-unknown -p controller

foray simulate --red ./target/wasm32-unknown-unknown/release/controller.wasm \
               --blue "$FORAY_HOME/references/greedy-raider.wasm" \
               --map "$FORAY_HOME/maps/mirror-32x16.toml" --out replay.json
```

All three baselines are built against the same
[controller contract](/testing/adversarial/foray/architecture/#the-controller-contract)
the model targets, so they double as worked examples of reading `world` and
returning `action`. The buildkit, the CLI, and the reference modules are compiled
from this repository at image-build time, so they stay in lockstep with the
engine the validator scores with. The image is defined under
`containers/adversarial/`.

## The baselines

### `random`

Picks a uniformly random legal move for each owned agent every tick, falling back
to `Stop` when boxed in. It does not seek seeds, defend, or prefer crossing the
border. It is the absolute floor: any serious controller beats it overwhelmingly,
and a controller that fails to has a bug.

### `greedy-raider`

Sends every agent to forage. Each one takes the shortest path to the nearest
enemy seed cache, eats whatever it reaches, and heads home only when it can carry
no more or is boxed out. It never defends and ignores carry weight, so it
over-loads and crawls home. Its two weaknesses are the two lessons of the case:
leaving your own caches undefended, and turning heavy raiders into easy tags.

### `border-soldier`

A naive balanced strategy. It statically assigns one agent to patrol the border
and chase the nearest visible intruder, and sends the other two in as
`greedy-raider`-style foragers. It is the strongest baseline, and its role
assignment never adapts: it does not reinforce a collapsing defence, recall a
raider to bank before it is caught, eat jelly, or contest a large seed. It
rewards a controller that reads the match state and reallocates its three agents
dynamically.

## The canonical opponent

A run is scored on one canonical match. The validator builds the model's
submission to wasm, loads it as Red, loads the case's committed `border-soldier`
module as Blue, and plays that match on the fixed `mirror-32x16` map and seed.
The published `replay.json` is that match, and the recorded outcome (win, loss,
draw, or forfeit, plus winner, score, and ticks) is from the submission's
perspective. `border-soldier` is the canonical opponent because it is the
strongest of the three baselines.

`random` and `greedy-raider` are local sparring partners. The finished run is
also auto-replayed against them and against the hidden `fuel-probe` reference,
which is never given to the model; see
[Evaluation](/testing/adversarial/evaluation/#proof-replays).

## Baseline weaknesses

The three baselines span the obvious failure space on purpose: pure noise,
pure greed, and rigid role-splitting. A model can therefore see what losing looks
like from three directions without being handed a winning shape. The interesting
strategy space is left entirely for the model to discover: balancing offence
against defence tick by tick, timing a bank against carry weight, spending jelly
both to survive and to kill, and contesting the drifting large seeds.
