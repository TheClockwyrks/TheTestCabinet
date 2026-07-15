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
**no-man's-land**. Every wall, tunnel, seed cache, large seed, and jelly node on one
side has a mirror twin on the other, so neither colony starts with a structural
advantage. Movement is **tile-locked**: each agent occupies one tile and on each
tick moves one tile **N / S / E / W** or holds (**Stop**). Walls block movement;
two agents may share a tile. The one move that is cancelled is the tag-dodging
swap — a **soldier and an enemy raider** exchanging tiles in one tick — so you
cannot slip *through* a defender. The pair is then treated as having **met**, and
the tagging rule settles it: absent jelly, the defender catches the raider. Every
other head-on swap (two soldiers crossing the seam, two raiders passing on their way
home) resolves normally.

The map is laid out around four fixtures:

- **Nests.** Each colony has a spawn nest against its back wall. Agents start
  there and respawn there.
- **Seed caches.** The ordinary scorable resource — small piles of seeds seeded
  across each colony's home half, mirrored between the two halves. Worth 1, and
  consumed when a raider eats it.
- **Large seeds.** A couple per half, worth *and weighing* three ordinary seeds.
  Unlike every other fixture they **move** (see [The twist](#the-twist)).
- **Royal jelly nodes.** A small number of power nodes per half (see
  [The twist](#the-twist)).

Illustrative starting layout: a `32 × 16` maze, the border between columns 15 and
16, three agents, and (say) 14 ordinary caches + 2 large seeds + 2 jelly nodes per
half — so a half is worth 20 in total. The authoritative values live in the case's
specs and `test-case.toml`, not here.

## Roles flip at the border

Foray's core rule is the **role flip**, and it is the single mechanic that makes
every agent both an attacker and a defender:

- An agent standing on **its own half** is a **soldier** (a defender).
- An agent standing on **the enemy half** is a **raider** (a forager). A raider
  **eats the enemy's seeds** and carries them.

An agent's role is therefore decided entirely by which half it currently stands
on — crossing the border flips it. A team's three agents are not typed; the
controller decides, tick by tick, who pushes across to raid and who stays home to
defend.

## Eating, carrying, banking

- A **raider** that steps onto an enemy seed cache **eats** it, adding **1** to its
  **load**. Stepping onto an enemy **large seed** picks it up whole, adding **3**.
  Carried seeds are not yet scored.
- A raider **banks** its load by **carrying it back across the border** onto its
  own half. The instant it crosses, its entire load is added to the team's score and
  its load resets to zero. A raider that is killed before banking scores nothing for
  what it was carrying.
- **Reaching home banks you before anything can kill you there.** Banking is settled
  before tagging within a tick, so an agent that crosses with a load has already
  scored by the time an enemy on the landing tile can act.

## Tagging and respawn

Two enemies **meet** when they share a tile, or when they try to trade tiles in one
tick (the cancelled swap). Because a role is decided purely by which half a tile is
on, a meeting is *always* one **soldier** against one enemy **raider** — there is no
other pairing. What happens turns only on royal jelly:

- **Neither is immune** — the **soldier tags the raider**. Home turf wins.
- **Exactly one is immune** — the **immune one tags the other**, whichever it is.
- **Both are immune** — nothing happens.

So **an immune ant cannot be killed, and it kills any non-immune enemy it meets.**
A soldier standing at home is *not* safe from an enemy raider running jelly.

A tagged ant **respawns at its nest**. A tagged **raider** also drops what it held:
its ordinary seeds scatter at the tag tile as recoverable caches, and a large seed
drops there **intact** — still one object, still worth 3. Defending well therefore
not only stops a raid, it hands the seeds back to your side.

## The twist

Foray changes the levers every published CTF strategy leans on. The changes are
thematically native to ants, and all are **proposed defaults** — the exact constants
are tunable in the specs.

### Carry weight — the signature mechanic

A raider's speed **degrades with its load**, and — like Pac-Man against the
ghosts — an **unladen raider is slightly faster than a soldier**, which is what
lets a colony break a defended line at all. Movement uses a fixed-point speed
accumulator (each agent banks *charge* per tick and steps a tile once it has a
tile's worth), so speeds can be finer than one tile per tick: a soldier moves a
shade under every tick, a **light raider (load ≤ 3) moves every tick**, and past a
load of three a raider loses speed per extra unit — matching the soldier at 4,
slower by the same margin at 5, and crawling under a heavy load. The exact curve is
in the case's specs.

The quantity is **load**, not the number of objects held: a **large seed weighs 3**,
exactly what it is worth. So a raider carrying nothing but a large seed sits at load
3 — still light, still outrunning every defender, so the clean snatch-and-run works
— while one ordinary seed on top of it drops it to soldier speed.

This turns the central CTF question — *grab as much as possible, then run* — on
its head. Hoarding makes you slow and easy to tag, and a tagged raider loses
**everything** it was carrying. The opposed tension lives in one quantity: **load
is both your score and your vulnerability**, so *when to break off and bank* is
now a real, continuous decision rather than an afterthought. A controller ported
straight from the original contest will over-load and bleed seeds to defenders.

### Large seeds — the moving prize

Each half holds a couple of **large seeds**, worth (and weighing) three ordinary
ones. They are the only fixture on the board that **moves**, and everything about
them follows from that.

A large seed **drifts one tile at a time toward the border, whether or not anyone is
standing on it** — so unlike an ordinary cache it cannot be squatted; it simply walks
out from under a defender. Nothing but the border stops it: it comes to rest on the
last column of its own half, on the seam, one step from an enemy raider who can take
it and bank it by stepping straight home. It never crosses on its own — a seed is
*stolen by a raid*, never conceded by the clock — but ignoring it is close to giving
it away.

The defence's answer is to **recall** it: an ant of the seed's own colony stands on
it for a stretch of consecutive ticks and it snaps back to its spawn. That costs the
walk out and the walk back, and an agent spent walking is an agent not raiding. A
seed cannot be recalled until it has drifted a few tiles from home, so a defender
can neither pin one on its spawn nor camp the next tile and yo-yo it back forever.

Tag a raider hauling one and it drops **intact** at the tag tile, deep in your own
territory, and starts drifting again from there — which makes running down a
big-seed carrier one of the best defensive plays in the game.

### Royal jelly

Eating a **royal jelly** node grants **the eater** **immunity** for a window of `J`
ticks (a scent-mask / adrenal surge). While it lasts, the immune ant **cannot be
tagged** *and* **tags any non-immune enemy it meets** — including a soldier standing
safely on its own half. Immunity is not merely a shield; it is a weapon.

That makes jelly the counter to two different problems. It is how you punch a heavy
load home through a defended border, and it is how you break a defender that has
parked itself on something you want. A defender squatting a cache is untouchable
right up until a raider arrives with jelly running.

And a consumed node **grows back**, at the same tile, after a respawn window. Jelly
is a renewable resource on a cycle rather than a pair of one-shot charges — which is
exactly why no defender can hold a position forever. Immunity travels with the ant,
not the role, so a raider that eats jelly and runs home is an *immune soldier* for
the rest of its window.

## Winning

A match ends the moment **either** condition is met:

- **Sweep — bank every seed from the enemy half.** As soon as one colony has eaten
  and banked the enemy half's **full value**, it has stripped the enemy larder and
  **wins immediately**, regardless of the score on its own side. This is the decisive
  win. Large seeds count at their full worth, so you cannot sweep without taking both
  of them.
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
