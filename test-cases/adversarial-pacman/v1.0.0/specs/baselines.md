# The reference controllers

The workspace ships three **baseline controllers** under `references/`, each with
its Rust source (`references/<name>/lib.rs`) and a pre-built module
(`references/<name>.wasm`). They are there to give you a concrete opponent to
compile, run, and play against while you develop — a yardstick, **not** a template.

Every baseline is **deliberately mediocre**. Each has an obvious, exploitable
weakness, and none of them accounts properly for Foray's twist (carry weight and
royal jelly). The point of the case is to write a controller that beats these
comfortably and then beats other models. A submission that merely matches a
baseline has not done the work. You may read their source freely; you are expected
**not** to copy it.

> The references intentionally ignore parts of the ruleset. A controller that
> imitates one inherits its weakness. Treat them as opponents to dismantle, not
> as a starting architecture.

## The baselines

### `random` — the floor

Picks a **uniformly random legal move** for each owned agent every tick (falling
back to `Stop` when boxed in). It does not seek seeds, defend, or even prefer
crossing the border. It is the absolute floor: any serious controller should beat
it overwhelmingly, and one that does not has a bug.

### `greedy-raider` — all offence, no sense

Sends **every** agent to forage: each one beelines (shortest path) to the
**nearest enemy seed cache**, eats whatever it reaches, and only heads home when
it can carry no more or is boxed out. It **never defends** and **ignores carry
weight** — it over-loads and crawls home. Its two weaknesses are the two lessons
of the case: leaving your own caches completely undefended, and turning heavy
raiders into easy tags. A competent defender shreds it.

### `border-soldier` — a token balance

A naive "balanced" strategy: it **statically** assigns one agent to patrol the
border and chase the nearest visible intruder, and sends the other two in as
`greedy-raider`-style foragers. It is the **strongest** baseline, but its role
split **never adapts** — it does not reinforce a collapsing defence, recall a
raider to bank before it is caught, reason about jelly, or weigh load against the
distance home. It rewards a controller that reads the match state and reallocates
its three agents dynamically.

**`border-soldier` is the canonical scoring opponent.** When the harness scores
your submission it runs **one** match: your controller as Red against
`border-soldier` as Blue, on the shipped `mirror-32x16` map. Beating
`border-soldier` decisively is the bar to clear; the interesting margin is *how*
you beat it.

## Why none of them is good

The three span the obvious failure space on purpose — pure noise (`random`), pure
greed (`greedy-raider`), and rigid role-splitting (`border-soldier`) — so you can
see what losing looks like from three directions without being handed a winning
shape. The real strategy space — balancing offence against defence tick by tick,
timing a bank against carry weight, and spending jelly to run a heavy load home
— is left entirely for you to discover.

## Iterating locally

Build the local `foray` CLI once (it hosts the same engine the harness scores
with), then run matches against any baseline:

```bash
# build the CLI (host target) — one time
cargo build --release --manifest-path tools/Cargo.toml --target-dir tools/target

# build your controller to wasm
cargo build --release --target wasm32-unknown-unknown -p controller

# play your controller (Red) against a baseline (Blue) and write a replay
./tools/target/release/foray simulate \
  --red  target/wasm32-unknown-unknown/release/controller.wasm \
  --blue references/border-soldier.wasm \
  --map  maps/mirror-32x16.toml \
  --seed 0xC0FFEE \
  --out  replay.json
```

The CLI prints the winner, the outcome (`swept` / `time_limit` / `forfeit`), and
the tick count, and writes a `replay.json` you can inspect. Swap `--blue` for
`references/random.wasm` or `references/greedy-raider.wasm` to test against the
other baselines, and try a few `--seed` values to make sure you are not overfitting
one maze. The canonical scoring match uses `--seed 0xC0FFEE` against
`border-soldier`.
