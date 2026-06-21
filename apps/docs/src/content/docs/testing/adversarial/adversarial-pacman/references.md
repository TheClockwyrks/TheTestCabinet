---
title: "Reference controllers"
---

Foray ships a handful of **baseline controllers** to the model in the seeded
workspace, alongside the [`foray` CLI](/testing/adversarial/adversarial-pacman/architecture/#the-cli)
and the map definitions. Their purpose is to give the model something concrete to
**compile, run, and play against locally** while it develops its own controller —
a yardstick, not a template.

Every baseline is **deliberately mediocre**. Each one has an obvious, exploitable
weakness, and none of them accounts properly for Foray's
[twist](/testing/adversarial/adversarial-pacman/overview/#the-twist). The point
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

In the seeded workspace the model gets, for each baseline:

- the **wasm-buildable Rust source** of the controller, and
- a pre-built `.wasm` module (or the one-line command to build it),

so it can immediately run, e.g.:

```bash
foray simulate --red ./target/.../my-controller.wasm \
               --blue ./references/greedy-raider.wasm \
               --map maps/mirror-32x16.toml --out replay.json
```

and iterate against a known opponent. All three are written against the same
[controller contract](/testing/adversarial/adversarial-pacman/architecture/#the-controller-contract)
the model targets, so they double as worked examples of reading `world` and
returning `action`.

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

## Why none of them is good

The three baselines span the obvious failure space on purpose — pure noise
(`random`), pure greed (`greedy-raider`), and rigid role-splitting
(`border-soldier`) — so the model can see *what losing looks like* from three
directions without being handed a winning shape. The interesting strategy space —
balancing offence against defence tick by tick, timing a bank against carry
weight, and spending jelly to run a heavy load home — is left **entirely** for the
model to discover.
