# Valence — Matter: hit points, damage types, and stackable traits

This file defines the **matter** you defend against — how a unit takes damage, the three
**damage types**, the three **stackable traits** that gate what can hurt or even see it,
the specific matter types and their stats, and how a wave is built. It builds on the board
and lanes in `specs/board.md`, the towers in `specs/towers.md`, and the round progression
in `specs/flow.md`. Speeds are in logical pixels per second; energy and integrity values
are unitless game numbers.

The stat numbers below are the **base** (Round 1) values and are **fixed**; implement them
exactly as written. Equally important is the **behavior**: hit points, the three damage
types, the three traits and how they **stack**, and how fragments continue.

## The core model: hit points, damage, and traits

Valence is **not** a "one form, one tool" ladder. Every unit is a bundle of **hit points**
and **traits**, and any tower that can reach it chips it down. Concretely:

- **Shells are hit points.** Every unit carries **electron shells** — its hit points. A
  damage tower's shot removes a number of shells (its **damage**); a unit stripped to
  **zero** shells is **neutralized**, removed, and pays its **energy** bounty
  (`specs/flow.md`), with a neutralize burst (`specs/assets.md`).
- **There are three damage types**, one per damage-tower family (`specs/towers.md`):
  **energy**, **kinetic**, and **nuclear**. On an ordinary unit all three strip shells the
  same way; what differs is how each interacts with a unit's **traits** (below). Reading a
  unit is reading its **traits**, not memorizing a single counter.
- **Traits gate and modify damage, and they stack.** A unit carries zero or more of three
  traits — **bonded**, **heavy**, **inert** — and late in the run they **combine** on one
  unit. A trait never makes a unit answerable by exactly one tower; it makes it answerable
  by a **kind of tower**, of which there are always several (`specs/towers.md`).

Every unit shows an **integrity read** appropriate to its makeup so the player can see
progress: a free atom's remaining shells (as rings), a bonded cluster's remaining bond
integrity (a draining arc), a heavy's remaining shells (a draining arc), and a
shroud/cloak mark on inert matter. Draw them so the traits are unmistakable at speed
(`specs/overview.md`).

## The three traits

### Bonded — an outer bond pool any tower chips through

A **bonded** unit (a molecule) is a cluster of atoms wrapped in an **outer
bond-integrity pool** — a layer of **extra hit points that sits in front of its atoms**.
**Any** damage type reduces the bond pool; there is no special "bond-breaker" lock. As
the pool drains past each fragment threshold the cluster **sheds a free atom** off its
leading end — a molecule becoming a spray of atoms — and when the pool is spent the
cluster's **last atom** travels on free. A `k`-atom cluster sheds `k − 1` atoms as its
bonds are chipped away and continues as the final free atom, so it releases `k` free
atoms in all.

- **Kinetic damage is best against bonds:** a kinetic shot deals its damage to the bond
  pool **times a bonus** (base `×2`; the **Cleaver** deepens it). So a Cleaver opens
  clusters **fastest**, but an Ionizer, an Emitter, a Beam, or a Reactor all chip the
  same bonds — slower, not never. Freed atoms are a little **faster** than the cluster
  they came from (capped — see the stats).
- Freed atoms are ordinary free atoms an energy tower then finishes. If a cluster is also
  **inert** (a Chelate), the atoms it sheds are **inert too** (they still need detection).

### Heavy — immune to energy; kinetic or nuclear only

A **heavy** unit is a dense nucleus that **energy damage cannot touch at all**. Only
**kinetic** or **nuclear** damage strips its shells — so a **Cleaver**, a **Reactor**,
or a **Beam** running its **Disruptor** branch (`specs/towers.md`) all crack a heavy; an
Emitter, an Ionizer, or a plain Beam do nothing to it. A heavy stripped to zero shells
**splits** into **two lighter daughter atoms** (free atoms, ordinary energy fodder) plus
a split flash (`specs/assets.md`). A board with **no** kinetic and **no** nuclear damage
cannot stop heavies, and they leak — but the answer is a **class** of towers, not one
tower.

### Inert — untargetable until it is detected

An **inert** unit (noble matter) is sealed and **untargetable by every tower until a
detector reveals it**. Detection comes from **several** sources (`specs/towers.md`), not
one:

- a **Catalyst**'s field reveals inert matter inside it (and it **lingers** revealed for a
  short time after leaving the field);
- a **Reactor**'s **Fallout** zone reveals inert matter inside the zone;
- an **Ionizer** that has taken its **Array** branch sees inert matter itself;
- a **Beam** sees inert matter **natively**, at every tier.

While revealed, an inert unit is an ordinary unit its other traits still describe (a
revealed inert **atom** is energy fodder; a revealed inert **heavy** still needs
kinetic/nuclear). An inert unit that reaches the collector unrevealed leaks normally.

### Traits stack

Traits are not exclusive. Early rounds show them one at a time; late rounds **combine**
them on a single unit, and the combination is the point — it forces a **layered**
defense rather than one counter:

- a **Shroud** is **inert + heavy**: it must be **detected** *and* hit with **kinetic or
  nuclear** — energy alone, even once it is revealed, does nothing;
- a **Chelate** is **inert + bonded**: it must be **detected** before any tower can chip
  its bonds, and the atoms it sheds are inert too.

No single tower answers a stacked-trait unit; a board that has spread its capabilities
does.

## Damage types vs traits — the whole interaction

| Damage type | Towers (base) | vs a plain atom's shells | vs a bonded pool | vs a heavy |
| --- | --- | --- | --- | --- |
| **Energy** | Emitter, Ionizer, Beam | normal | normal | **nothing** |
| **Kinetic** | Cleaver | normal | **×2 (Cleaver deepens)** | **yes** |
| **Nuclear** | Reactor | normal | normal | **yes** |

Detection (seeing **inert** matter) is orthogonal to damage type and is carried by the
Catalyst aura, the Reactor Fallout zone, the Ionizer Array branch, and the Beam
(`specs/towers.md`). A tower may act on a unit only if it can **see** it **and** its
damage type can **reach** it.

## Matter types

The base (Round 1) roster. `Shells` is a free atom's or heavy's starting hit points;
`Atoms/Bond` is a bonded cluster's atom count and its outer bond-integrity pool; `Traits`
lists the stacked traits. Per-round scaling of these is in `specs/flow.md`.

| Type | Traits | Structure (Round 1) | Speed | Energy | Leak | What it asks of the board |
| --- | --- | --- | --- | --- | --- | --- |
| **Monatom** | — | 2 shells | 55 | 2 | 1 | any damage |
| **Swift** | — | 1 shell | 110 | 2 | 1 | any damage (fast — wants a slow) |
| **Dimer** | bonded | 2 atoms, bond 4 | 50 | 5 | 1 | chip bonds (kinetic best), then strip |
| **Polymer** | bonded | 4 atoms, bond 10 | 40 | 10 | 2 | chip a big bond pool → a spray |
| **Noble** | inert | 2 shells | 65 | 6 | 1 | detect, then any damage |
| **Heavy** | heavy | 5 shells | 35 | 12 | 2 | kinetic or nuclear only |
| **Chelate** | inert + bonded | 3 atoms, bond 8 | 48 | 12 | 2 | detect, then chip bonds |
| **Shroud** | inert + heavy | 5 shells | 40 | 16 | 2 | detect **and** kinetic/nuclear |
| **Macromass** | heavy (boss) | see below | 28 | 140 | 12 | a kinetic/nuclear line + cleanup |

- **Monatom** — the baseline atom; the bulk of early rounds.
- **Swift** — a fragile atom at double speed; punishes a board with no **Moderator** to
  slow it.
- **Dimer / Polymer** — bonded clusters. Their bond pool is extra health any tower
  chips, but **kinetic** (the Cleaver) chews it fastest; a Polymer's big pool becomes a
  **spray** of four atoms that floods the strippers behind it.
- **Noble** — inert; nothing can touch it until a detector reveals it, then a plain atom.
- **Heavy** — energy-immune; only kinetic or nuclear crack it, and it splits into two
  daughters. Several towers answer it, but a board with none leaks.
- **Chelate** — a cloaked cluster: reveal it, then chip its bonds (its shed atoms stay
  inert).
- **Shroud** — a cloaked heavy: reveal it **and** bring kinetic/nuclear. The hardest
  single unit; it exists only because traits stack.
- **Macromass** — the **boss** (below).

## The boss — Macromass

A **Macromass** is a huge unstable isotope that anchors the milestone rounds
(`specs/flow.md`). It is a **heavy** (energy-immune, so only kinetic/nuclear hurt it)
with a very large shell pool (base **26**), and it is **immune to being slowed** by a
Moderator (too massive). As its shells are worn down it **fountains matter**: each time
its hit points cross a **fragment step** it **sheds a fragment** — a Dimer or a pair of
free atoms — onto its lane while continuing, and when its shells are finally spent the
core **bursts** into a last spray. So the boss is not a single wall of health but a
**stream** the kinetic/nuclear line cracks while the strippers behind it clean up the
fragments. It moves slowly (speed 28), leaks **12** integrity, and pays a large bounty
(140) plus whatever its fragments pay. Its exact fragment schedule is yours to tune
within this shape, but it must genuinely **fragment as it is worn down**, not simply
drain a bar. (Reference: base **6** fragment steps, `+3` on the final Round 20 boss.)

## Wave composition

A round is a timed sequence of units released from the inlet across both lanes
(`specs/board.md`); the exact spawn timing and lane weighting per round is yours to
design, within `specs/flow.md`'s progression. Compose rounds so the player cannot answer
everything with one tower or one damage type:

- Early rounds are mostly **Monatoms** and **Swifts** — teach stripping and the need to
  slow the fast units.
- **Dimers** and then **Polymers** enter, teaching that bonds are extra health best
  chewed by **kinetic** but chippable by anything.
- **Nobles** begin appearing, so the player must field **detection** (from any of its
  sources), and **Heavies**, so the player must field **kinetic or nuclear** — each a
  class no single-type board covers.
- The **combos** — **Chelate** (inert + bonded) and **Shroud** (inert + heavy) — arrive
  late, forcing **layered** answers (detect *and* the right damage).
- A **Macromass** boss anchors each milestone round (`specs/flow.md`), with the
  surrounding wave growing toward the late game.
- Reading the **next-round preview** (`specs/board.md`, `specs/flow.md`) — which names
  each coming type and what it asks of the board (detect / kinetic-nuclear / chip-bonds)
  — and re-shaping the board for it is the between-round game.

Because fragments continue on their lane, a cluster or heavy that is only **partly**
broken down still sends its pieces onward — a Polymer that slips the openers arrives as
an intact cluster the strippers cannot finish in time, and leaks. The pressure is always
to open each unit up **before** it reaches the collector.
