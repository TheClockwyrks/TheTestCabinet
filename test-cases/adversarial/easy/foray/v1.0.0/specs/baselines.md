# The reference controllers

The run environment provides three **baseline controllers** under
`$FORAY_HOME/references/`, each with its Rust source
(`$FORAY_HOME/references/<name>/lib.rs`) and a pre-built module
(`$FORAY_HOME/references/<name>.wasm`). They are there to give you a concrete
opponent to run and play against while you develop — a yardstick, **not** a
template. (`$FORAY_HOME` is `/opt/foray`; the `foray` CLI is on your `PATH`.)

Every baseline is **deliberately mediocre**. Each has an obvious, exploitable
weakness, and **not one of them accounts for any of Foray's three twists** — carry
weight, royal jelly, or the large seeds. In particular **no baseline ever eats
jelly**, and none of them treats a large seed as anything more than a seed that
happens to be where it is standing: they will walk onto one by accident and haul it
home without ever knowing what they picked up, and they will let their own drift
onto the seam and be taken for free. The point here is to write a controller that
beats these comfortably and then beats the field. A controller that merely matches a
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

### `greedy-raider` — all offense, no sense

Sends **every** agent to forage: each one beelines (shortest path) to the
**nearest enemy seed cache**, eats whatever it reaches, and only heads home when
it can carry no more or is boxed out. It **never defends** and **ignores carry
weight** — it over-loads and crawls home. Its two weaknesses are the two
lessons here: leaving your own caches completely undefended, and turning heavy
raiders into easy tags. A competent defender shreds it.

### `border-soldier` — a token balance

A naive "balanced" strategy: it **statically** assigns one agent to patrol the
border and chase the nearest visible intruder, and sends the other two in as
`greedy-raider`-style foragers. It is the **strongest** baseline, but its role
split **never adapts** — it does not reinforce a collapsing defense, recall a
raider to bank before it is caught, ever eat jelly (to survive a run home *or* to
kill a defender), contest or recall a large seed, or weigh load against the distance
home. It rewards a controller that reads the match state and reallocates its three
agents dynamically.

**`border-soldier` is the canonical benchmark opponent.** The benchmark runs
**one** match: your controller as Red against
`border-soldier` as Blue, on the shipped `mirror-32x16` map. Beating
`border-soldier` decisively is the bar to clear; the interesting margin is *how*
you beat it.

## Why none of them is good

The three span the obvious failure space on purpose — pure noise (`random`), pure
greed (`greedy-raider`), and rigid role-splitting (`border-soldier`) — so you can
see what losing looks like from three directions without being handed a winning
shape. The real strategy space — balancing offense against defense tick by tick,
timing a bank against carry weight, spending jelly both to survive and to kill, and
contesting the large seeds before they drift into the enemy's reach — is left
entirely for you to discover.

## Iterating locally

The `foray` CLI is preinstalled on your `PATH` (it hosts the same engine the
harness runs with). Build your controller, then run a match against any baseline:

```bash
# build your controller to wasm
cargo build --release --target wasm32-unknown-unknown -p controller

# play your controller (Red) against a baseline (Blue) and write a replay
foray simulate \
  --red  target/wasm32-unknown-unknown/release/controller.wasm \
  --blue "$FORAY_HOME/references/border-soldier.wasm" \
  --map  "$FORAY_HOME/maps/mirror-32x16.toml" \
  --seed 0xC0FFEE \
  --out  replay.json
```

The CLI prints the winner, the final score, and the outcome (`swept` /
`time_limit` / `forfeit`) with the tick count, and writes a `replay.json` you can
inspect. **On a forfeit it also prints which controller forfeited, on what tick,
and why** (out of fuel, over the memory cap, a trap, or a contract-invalid action)
— so when your controller loses on a technicality you can see exactly which limit
it broke. Swap `--blue` for `$FORAY_HOME/references/random.wasm` or
`$FORAY_HOME/references/greedy-raider.wasm` to test against the other baselines,
and try a few `--seed` values to make sure you are not overfitting one maze. The
canonical benchmark match uses `--seed 0xC0FFEE` against `border-soldier`.
