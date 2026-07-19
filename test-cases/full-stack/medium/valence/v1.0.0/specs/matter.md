# Valence — Matter: hit points, damage types, and stackable traits

This file defines the matter you defend against: how a unit takes damage, the
three damage types, the three stackable traits that gate what can hurt or even
see it, the specific matter types and their stats, and how a wave is built. It
builds on the board and paths in `specs/board.md`, the towers in
`specs/towers.md`, and the round progression in `specs/campaign.md`. Speeds are
in logical pixels per second; energy and integrity values are unitless game
numbers.

The stat numbers below are the base (Round 1) values and are fixed; implement
them exactly as written. Equally important is the behavior: hit points, the
three damage types, the three traits and how they stack, and how fragments
continue.

## The core model: hit points, damage, and traits

Valence is not a "one form, one tool" ladder. Every unit is a bundle of hit
points and traits, and any tower that can reach it chips it down. Concretely:

- Shells are hit points. Every unit carries electron shells, which are its hit
  points. A damage tower's shot removes a number of shells (its damage); a unit
  stripped to zero shells is neutralized, removed, and pays its energy bounty
  (`specs/campaign.md`), with a neutralize burst (`specs/assets.md`).
- There are three damage types, one per damage-tower family (`specs/towers.md`):
  energy, kinetic, and nuclear. On an ordinary unit all three strip shells the
  same way; what differs is how each interacts with a unit's traits (below).
  Reading a unit is reading its traits, not memorizing a single counter.
- Traits gate and modify damage, and they stack. A unit carries zero or more of
  three traits (bonded, heavy, inert), and late in the run they combine on one
  unit. A trait never makes a unit answerable by exactly one tower; it makes it
  answerable by a kind of tower, of which there are always several
  (`specs/towers.md`).

Every unit shows an integrity read appropriate to its makeup so the player can
see progress: a free atom's remaining electrons on its two shells (up to `2`
inner, up to `4` outer), a bonded cluster's remaining bond integrity (a draining
arc), a heavy isotope's remaining shells (a draining arc), and a shroud/cloak
mark on inert matter. Draw them so the traits are unmistakable at speed
(`specs/overview.md`).

## The three traits

### Bonded — an outer bond pool any tower chips through

A bonded unit (a molecule) is a cluster of atoms wrapped in an outer
bond-integrity pool, a layer of extra hit points that sits in front of its
atoms. Any damage type reduces the bond pool; there is no special "bond-breaker"
lock. As the pool drains past each fragment threshold the cluster sheds a free
atom off its leading end, a molecule becoming a spray of atoms, and when the
pool is spent the cluster's last atom travels on free. A `k`-atom cluster sheds
`k − 1` atoms as its bonds are chipped away and continues as the final free
atom, so it releases `k` free atoms in all.

- Kinetic damage is best against bonds: a kinetic shot deals its damage to the
  bond pool times a bonus (base `×2`; the Cleaver deepens it). So a Cleaver
  opens clusters fastest, but an Ionizer, an Emitter, a Beam, or a Reactor all
  chip the same bonds, slower rather than never. Freed atoms are a little faster
  than the cluster they came from (capped, see the stats).
- Freed atoms are ordinary free atoms an energy tower then finishes. If a
  cluster is also inert (a Chelate), the atoms it sheds are inert too (they
  still need detection).

### Heavy — a radioactive isotope; kinetic or nuclear only

A heavy unit is a dense, radioactive isotope whose nucleus energy damage cannot
touch at all. Only kinetic or nuclear damage wears down its shells, so a
Cleaver, a Reactor, or a Beam running its Disruptor branch (`specs/towers.md`)
all crack a heavy; an Emitter, an Ionizer, or a plain Beam do nothing to it. A
board with no kinetic and no nuclear damage cannot stop heavies, and they leak.
The answer is a class of towers, not one tower.

A heavy breaks down the way a real radioactive material does: it decays. As it
is worn down, each time its shells cross a decay step it emits a particle and
transmutes into a lighter isotope that travels on:

- an alpha particle is a full 6-electron atom, a tough chunk the strippers must
  chew down;
- a beta particle is a light 2-electron atom, small and quick.

An isotope's decay chain is a fixed sequence of these emissions (its identity);
it sheds them one per decay step as it is cracked, and when its shells are
finally spent it has reached a stable nucleus and is neutralized (paying its
bounty) with a split flash (`specs/assets.md`). So a cracked heavy is not two
tidy daughters but a stream of alpha and beta particles the energy strippers
behind the kinetic/nuclear line must clean up. A Shroud (below) decays the same
way, and the particles it emits stay inert. A base heavy carries `5` shells and
a short chain, one alpha and one beta.

### Inert — untargetable until it is detected

An inert unit (noble matter) is sealed and untargetable by every tower until a
detector reveals it. Detection comes from several sources (`specs/towers.md`),
not one:

- a Catalyst's field reveals inert matter inside it (and it lingers revealed for
  a short time after leaving the field);
- a Reactor's Fallout zone reveals inert matter inside the zone;
- an Ionizer that has taken its Array branch sees inert matter itself;
- a Beam sees inert matter natively, at every tier.

While revealed, an inert unit is an ordinary unit its other traits still
describe (a revealed inert atom is energy fodder; a revealed inert heavy still
needs kinetic/nuclear). An inert unit that reaches the collector unrevealed
leaks normally.

### Traits stack

Traits are not exclusive. Early rounds show them one at a time; late rounds
combine them on a single unit, and the combination is the point. It forces a
layered defense rather than one counter:

- a Shroud is inert + heavy: it must be detected and hit with kinetic or
  nuclear; energy alone, even once it is revealed, does nothing;
- a Chelate is inert + bonded: it must be detected before any tower can chip its
  bonds, and the atoms it sheds are inert too.

No single tower answers a stacked-trait unit; a board that has spread its
capabilities does.

## Damage types vs traits — the whole interaction

| Damage type | Towers (base)          | vs a plain atom's shells | vs a bonded pool     | vs a heavy |
| ----------- | ---------------------- | ------------------------ | -------------------- | ---------- |
| Energy      | Emitter, Ionizer, Beam | normal                   | normal               | nothing    |
| Kinetic     | Cleaver                | normal                   | ×2 (Cleaver deepens) | yes        |
| Nuclear     | Reactor                | normal                   | normal               | yes        |

Detection (seeing inert matter) is orthogonal to damage type and is carried by
the Catalyst aura, the Reactor Fallout zone, the Ionizer Array branch, and the
Beam (`specs/towers.md`). A tower may act on a unit only if it can see it and
its damage type can reach it.

## Matter types

The base (Round 1) roster. For a regular Atom, `Structure` is its electron count
(`1`–`6`), which is its shells and its hit points; for an isotope, `Structure`
is its starting shells; `Atoms/Bond` is a bonded cluster's atom count and its
outer bond-integrity pool; `Traits` lists the stacked traits. Per-round scaling
of these is in `specs/campaign.md`.

| Type            | Traits         | Structure (Round 1)      | Speed  | Energy | Leak                    | What it asks of the board                |
| --------------- | -------------- | ------------------------ | ------ | ------ | ----------------------- | ---------------------------------------- |
| Atom            | —              | 1–6 electrons (= shells) | 44–112 | 2–8    | its remaining electrons | any damage                               |
| Dimer           | bonded         | 2 atoms, bond 4          | 50     | 5      | 1                       | chip bonds (kinetic best), then strip    |
| Polymer         | bonded         | 4 atoms, bond 10         | 40     | 10     | 2                       | chip a big bond pool → a spray           |
| Noble           | inert          | 3 electrons              | 60     | 6      | its remaining electrons | detect, then any damage                  |
| Isotope (heavy) | heavy          | 5 shells                 | 36     | 12     | 3                       | kinetic or nuclear; decays to alpha/beta |
| Chelate         | inert + bonded | 3 atoms, bond 8          | 48     | 12     | 2                       | detect, then chip bonds                  |
| Shroud          | inert + heavy  | 5 shells                 | 40     | 16     | 3                       | detect and kinetic/nuclear               |
| Macromass       | heavy (boss)   | see below                | 28     | 140    | 12                      | a kinetic/nuclear line + cleanup         |

- Atom, the regular unit and the bulk of every round, carrying a number of
  electrons (its layers, `1`–`6`). Each electron is one shell, one hit point
  that any damage type strips: a `6`-electron atom is six hits deep, a
  `1`-electron atom a single hit. Fewer electrons make a lighter, faster atom (a
  `1`-electron atom is the fast, fragile unit that punishes a board with no
  Moderator to slow it); more make a slower, tougher one. Its electrons render
  on two shells (up to `2` inner and up to `4` outer) and it visibly sheds an
  electron each time it is stripped. Its bounty rises with its starting electron
  count, and a leaking atom costs its remaining electrons in integrity, so
  partial damage still helps. Which sizes a round fields ramps with the round
  (Wave composition, below).
- Dimer / Polymer, bonded clusters. Their bond pool is extra health any tower
  chips, but kinetic (the Cleaver) chews it fastest; a Polymer's big pool
  becomes a spray of four atoms that floods the strippers behind it.
- Noble, an inert atom; nothing can touch it until a detector reveals it, then
  an ordinary atom.
- Isotope (heavy), energy-immune and radioactive: only kinetic or nuclear wears
  it down, and as it is cracked it decays, emitting alpha (`6`-electron) and
  beta (`2`-electron) atoms and transmuting to a lighter isotope until it
  reaches a stable nucleus. Several towers answer it, but a board with none
  leaks.
- Chelate, a cloaked cluster: reveal it, then chip its bonds (its shed atoms
  stay inert).
- Shroud, a cloaked isotope: reveal it and bring kinetic/nuclear, and the
  alpha/beta particles it decays into stay inert. The hardest single unit; it
  exists only because traits stack.
- Macromass, the boss (below).

## The boss — Macromass

A Macromass is the heaviest matter in the game: a super-heavy, highly unstable
isotope, a uranium/plutonium-class nucleus with a long decay chain, that anchors
the milestone rounds (`specs/campaign.md`). Like any isotope it is heavy
(energy-immune, so only kinetic/nuclear hurt it) with a very large shell pool
(base `26`), and it is immune to being slowed by a Moderator (too massive). As
its shells are worn down it fountains matter: at each decay step it emits the
next particle in its chain, an alpha (a `6`-electron atom) or a beta (a
`2`-electron atom), onto its path and transmutes into a lighter isotope while
continuing, and when its shells are finally spent the core bursts, emitting any
remaining steps at once and neutralizing (a stable nucleus). So the boss is not
a single wall of health but a stream of alpha and beta particles the
kinetic/nuclear line cracks while the strippers behind it clean up. It moves
slowly (speed 28), leaks `12` integrity, and pays a large bounty (140) plus
whatever its particles pay. Its exact decay chain is yours to tune within this
shape, but it must genuinely fragment into alpha/beta particles as it is worn
down, not simply drain a bar. A base decay chain is `6` steps alternating
beta/alpha, `+3` on the final Round 20 boss.

## Wave composition

A round is a timed sequence of units released from the inlet(s) and distributed
across the map's paths (`specs/board.md`); the exact spawn timing and path
weighting per round is yours to design, within `specs/campaign.md`'s
progression. Compose rounds so the player cannot answer everything with one
tower or one damage type:

- Early rounds are mostly small atoms (one or two electrons), teaching stripping
  and the need to slow the fast, low-electron ones.
- The electron ramp. Every round fields regular atoms, but which sizes grows
  with the round: early rounds are `1`–`2`-electron atoms, and the size window
  shifts up and drops its tiny sizes over the run until the late rounds field
  the full `6`-electron atoms. More electrons is more health per unit, so a late
  swarm is far tougher than an early one even though both are just atoms. Pick
  each atom's size from the round's window, weighting toward the top so waves
  escalate.
- Dimers and then Polymers enter, teaching that bonds are extra health best
  chewed by kinetic but chippable by anything.
- Nobles begin appearing, so the player must field detection (from any of its
  sources), and Isotopes (heavies), so the player must field kinetic or nuclear.
  Each is a class no single-type board covers. A cracked isotope decays into a
  spray of alpha/beta atoms the strippers must then finish.
- The combos, Chelate (inert + bonded) and Shroud (inert + heavy), arrive late,
  forcing layered answers (detect and the right damage).
- A Macromass boss anchors each milestone round (`specs/campaign.md`), with the
  surrounding wave growing toward the late game.
- Reading the next-round preview (`specs/board.md`, `specs/campaign.md`), which
  names each coming type and what it asks of the board (detect / kinetic-nuclear
  / chip-bonds), and re-shaping the board for it is the between-round game.

Because fragments continue on their path, a cluster or heavy that is only partly
broken down still sends its pieces onward. A Polymer that slips the openers
arrives as an intact cluster the strippers cannot finish in time, and leaks. The
pressure is always to open each unit up before it reaches the collector.
