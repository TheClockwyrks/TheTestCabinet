---
title: "Foray — overview"
---

**Foray** is the first [adversarial](/testing/adversarial/overview/) test case.
It is a territorial maze-raiding contest for two teams of three agents, and the
model's job is to write the **controller** that drives one team — a classical-AI
problem with no model in the loop once the controller is compiled. This page
documents the **rules of the game**; the supporting code is covered in
[Game code & replay](/testing/adversarial/foray/architecture/), the
baseline controllers in
[Reference controllers](/testing/adversarial/foray/references/), and
the look in
[Visual assets](/testing/adversarial/foray/assets/).

:::note[Provenance]
Foray descends from the **UC Berkeley CS188 "Pacman Capture-the-Flag" contest**,
the canonical classical-AI adversarial assignment. The base loop is faithful to
that well-understood problem so the design effort sits in the wasm/replay/asset
infrastructure rather than in inventing rules. Foray then makes two deliberate
rule changes (see [The twist](#the-twist)) so a model **cannot win by reciting a
published CTF strategy** — the optimal play under Foray's rules is materially
different from the original contest.

The on-disk slug is `foray`, matching the in-fiction title **Foray**.
:::

## The world

Two ant colonies — **Red** (west) and **Blue** (east) — share a single
**mirror-symmetric maze** of dug tunnels, split down the centre by a contested
**no-man's-land**. Every wall, tunnel, seed cache, and jelly node on one side has
a mirror twin on the other, so neither colony starts with a structural
advantage. Movement is **tile-locked**: each agent occupies one tile and on each
tick moves one tile **N / S / E / W** or holds (**Stop**). Walls block movement;
two agents may share a tile. The one move that is cancelled is the tag-dodging
swap — a **soldier and an enemy raider** exchanging tiles in one tick — so you
cannot slip *through* a defender; every other head-on swap (two soldiers crossing
the seam, two raiders passing on their way home) resolves normally.

The map is laid out around three fixtures:

- **Nests.** Each colony has a spawn nest against its back wall. Agents start
  there and respawn there.
- **Seed caches.** The scorable resource — small piles of seeds seeded across
  each colony's home half, mirrored between the two halves. A cache is consumed
  when a raider eats it.
- **Royal jelly nodes.** A small number of power nodes per half (see
  [The twist](#the-twist)).

Illustrative starting layout: a `32 × 16` maze, the border between columns 15 and
16, three agents and (say) ~20 seed caches and 2 jelly nodes per half. The
authoritative values live in the case's specs and `test-case.toml`, not here.

## Roles flip at the border

Foray's core rule is the **role flip**, and it is the single mechanic that makes
every agent both an attacker and a defender:

- An agent standing on **its own half** is a **soldier** (a defender — the
  "ghost"). A soldier can **tag** enemy raiders that are on its turf.
- An agent standing on **the enemy half** is a **raider** (a forager — the
  "pac"). A raider **eats the enemy's seed caches** and carries the seeds.

An agent's role is therefore decided entirely by which half it currently stands
on — crossing the border flips it. A team's three agents are not typed; the
controller decides, tick by tick, who pushes across to raid and who stays home to
defend.

## Eating, carrying, banking

- A **raider** that steps onto an enemy seed cache **eats** it and adds it to the
  raider's **carried load**. Carried seeds are not yet scored.
- A raider **banks** its load by **carrying it back across the border** onto its
  own half. The instant it crosses, the entire carried load is added to the
  team's score and the raider's load resets to zero. A raider that is killed
  before banking scores nothing for what it was carrying.

## Tagging and respawn

- A **soldier** that shares a tile with an enemy **raider** on the soldier's own
  half **tags** it (whether the soldier moved onto the raider or the raider onto
  the soldier).
- A tagged raider **respawns at its nest** and its carried load is **dropped onto
  the maze** at the tag location, scattering back into play as recoverable caches
  on the defender's territory. Defending well therefore not only stops a raid, it
  hands the seeds back to your side.
- Soldiers cannot be tagged on their own half. The border itself is safe — an
  agent is only ever a raider (and thus taggable) once it is fully across.

## The twist

Foray changes the two levers every published CTF strategy leans on. Both changes
are thematically native to ants, and both are **proposed defaults** — the exact
constants are tunable in the specs.

### Carry weight — the signature mechanic

A raider's speed **degrades with its load**, and — like Pac-Man against the
ghosts — an **unladen raider is slightly faster than a soldier**, which is what
lets a colony break a defended line at all. Movement uses a fixed-point speed
accumulator (each agent banks *charge* per tick and steps a tile once it has a
tile's worth), so speeds can be finer than one tile per tick: a soldier moves a
shade under every tick, a **light raider (load ≤ 3) moves every tick**, and past
three seeds a raider loses speed per extra seed — matching the soldier at 4 seeds,
slower by the same margin at 5, and crawling under a heavy load. The exact curve
is in the case's specs.

This turns the central CTF question — *grab as much as possible, then run* — on
its head. Hoarding makes you slow and easy to tag, and a tagged raider loses
**everything** it was carrying. The opposed tension lives in one quantity: **load
is both your score and your vulnerability**, so *when to break off and bank* is
now a real, continuous decision rather than an afterthought. A controller ported
straight from the original contest will over-load and bleed seeds to defenders.

### Royal jelly — the inverted capsule

In the original contest, eating a power capsule makes the **enemy** defenders
scared and edible. Foray inverts this completely. Eating a **royal jelly** node
grants **the eater** **tag-immunity** for a window of `J` ticks (a scent-mask /
adrenal surge): an immune raider **cannot be tagged**, so jelly is how you punch
a heavy load home through a defended border. It does **not** make soldiers
edible, and there is no "hunt the scared ghosts" phase.

Jelly is the deliberate counter to carry weight — the risky tool that lets a slow,
laden raider survive the run home — and it is precisely where rote knowledge
backfires: a model that treats jelly like a Berkeley capsule will chase defenders
that were never made vulnerable.

## Winning

A match ends the moment **either** condition is met:

- **Sweep — bank every seed from the enemy half.** As soon as one colony has
  eaten and banked **all** of the other colony's seeds, it has stripped the enemy
  larder and **wins immediately**, regardless of the score on its own side. This
  is the decisive win.
- **Time limit — the 10-minute cap.** A match is bounded to **10 minutes of game
  time**. This is *faked*, fixed-timestep time (see
  [lockstep](/testing/adversarial/overview/#lockstep-simulation-and-replays)), not
  wall-clock, so the cap bounds the match length deterministically while it still
  runs as fast as the host can compute. At a 16 ms timestep that is **37,500
  ticks** — the bound is set in game time and `max_ticks` follows from the
  timestep.

If the time limit is reached first, the colony with the **higher banked score**
wins. An equal banked score is broken by **efficiency**: the colony whose
controller consumed the **least total fuel** over the match wins, having reached
the same score for less work. Only a level score *and* level fuel is a true
**draw**. A controller that traps, exhausts its
[fuel or memory](/testing/adversarial/overview/#sandbox-and-execution), or emits a
contract-invalid action **forfeits** the match — see
[Evaluation](/testing/adversarial/evaluation/).
