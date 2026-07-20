# Valence — Matter: hit points, damage types, and stackable traits

This file defines the matter you defend against: how a unit takes damage, the
three damage types, the three stackable traits that gate what can hurt or even
see it, the specific matter types and their stats, and how a wave is built. It
builds on the board and paths in `specs/board.md`, the towers in
`specs/towers.md`, and the round progression in `specs/campaign.md`. Speeds are
in logical pixels per second; energy and integrity values are unitless game
numbers.

The stat numbers below are fixed and do not vary with the round; implement them
exactly as written. Equally important is the behavior: hit points, the three
damage types, the three traits and how they stack, and how fragments continue.

## The core model: hit points, damage, and traits

Valence is not a "one form, one tool" ladder. Every unit is a bundle of hit
points and traits, and any tower that can reach it chips it down. Concretely:

- Shells are hit points. Every unit carries electron shells, which are its hit
  points. A damage tower's shot removes a number of shells (its damage); a unit
  stripped to zero shells is neutralized and removed, with a neutralize burst
  (`specs/assets.md`). Energy is paid for the damage that stripped it, not for
  the kill (`specs/campaign.md`).
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
finally spent it has reached a stable nucleus and is neutralized with a split
flash (`specs/assets.md`). So a cracked heavy is not two
tidy daughters but a stream of alpha and beta particles the energy strippers
behind the kinetic/nuclear line must clean up. A Shroud (below) decays the same
way, and the particles it emits stay inert. An Isotope carries `9` shells and a
chain of two alphas and a beta.

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

The roster. These values are fixed and do not change with the round: a Dimer is
the same unit in Round 3 and Round 38 (`specs/campaign.md`).

`Structure` is what the unit is made of. For an Atom it is the electron count
(`1`–`6`), which is its shells and its hit points; for an isotope, its starting
shells and its decay chain; for a bonded cluster, its constituent atom count and
its outer bond-integrity pool. `Total shells` is everything the board must strip
to finish the unit outright, its own hit points plus everything it fragments
into, which is also exactly what it pays out (`specs/campaign.md`).

| Type            | Traits         | Structure                          | Total shells | Speed  | Leak                    | What it asks of the board                |
| --------------- | -------------- | ---------------------------------- | ------------ | ------ | ----------------------- | ---------------------------------------- |
| Atom            | —              | 1–6 electrons (= shells)           | 1–6          | 44–112 | its remaining electrons | any damage                               |
| Noble           | inert          | 1–6 electrons, shielded            | 1–6          | 44–112 | its remaining electrons | detect, then any damage                  |
| Dimer           | bonded         | 2 atoms of 3, bond 5               | 11           | 50     | 1                       | chip bonds (kinetic best), then strip    |
| Polymer         | bonded         | 6 atoms of 6, bond 11              | 47           | 40     | 2                       | chip a bond pool → a spray               |
| Lattice         | bonded         | 16 atoms of 6, bond 8              | 104          | 34     | 4                       | a thin pool over a flood of atoms        |
| Isotope (heavy) | heavy          | 9 shells, chain α α β              | 23           | 36     | 3                       | kinetic or nuclear; decays to α/β        |
| Chelate         | inert + bonded | 6 atoms of 6, bond 11, shielded    | 47           | 44     | 2                       | detect, then chip bonds                  |
| Shroud          | inert + heavy  | 9 shells, chain α α β, shielded    | 23           | 38     | 3                       | detect and kinetic/nuclear               |
| Macromass       | heavy + bonded | see below                          | 616          | 28     | 12                      | a kinetic/nuclear line + cleanup         |

- Atom, the regular unit and the bulk of every round, carrying a number of
  electrons (its layers, `1`–`6`). Each electron is one shell, one hit point
  that any damage type strips: a `6`-electron atom is six hits deep, a
  `1`-electron atom a single hit. Fewer electrons make a lighter, faster atom (a
  `1`-electron atom is the fast, fragile unit that punishes a board with no
  Moderator to slow it); more make a slower, tougher one. Its electrons render
  on two shells (up to `2` inner and up to `4` outer) and it visibly sheds an
  electron each time it is stripped. A leaking atom costs its remaining electrons
  in integrity, so partial damage still helps. Which sizes a round fields is set
  by the round table (Wave composition, below).
- Noble, a shielded atom: nothing can touch it until a detector reveals it, and
  once revealed it is an ordinary atom of its size.
- Dimer / Polymer / Lattice, the bonded clusters, in ascending weight. Their bond
  pool is extra health any tower chips, but kinetic (the Cleaver) chews it
  fastest. A Lattice is the heaviest matter short of the boss and is built the
  opposite way round to its size: a thin pool of `8` over `16` atoms, so it opens
  quickly and then floods the strippers behind it with a spray no single tower
  clears.
- Isotope (heavy), energy-immune and radioactive: only kinetic or nuclear wears
  it down, and as it is cracked it decays, emitting alpha (`6`-electron) and
  beta (`2`-electron) atoms and transmuting to a lighter isotope until it
  reaches a stable nucleus. Several towers answer it, but a board with none
  leaks.
- Chelate, a shielded cluster: reveal it, then chip its bonds (its shed atoms
  stay shielded).
- Shroud, a shielded isotope: reveal it and bring kinetic/nuclear, and the
  alpha/beta particles it decays into stay shielded.
- Macromass, the boss (below).

Any type may be released shielded, whichever traits it already carries. A
shielded unit is untargetable until a detector reveals it, and everything it
fragments into stays shielded. Noble, Chelate, and Shroud are the shielded Atom,
Polymer, and Isotope; the round table may call for a shielded Dimer or Lattice
the same way.

## The boss — Macromass

A Macromass is the heaviest matter in the game: a super-heavy, highly unstable
nucleus behind its own containment, and the whole of Round 40
(`specs/campaign.md`). It is the only unit carrying both traits at once. A
containment pool of `180` sits in front of it, chipped like any bond pool, and
behind that a nucleus of `132` shells that only kinetic or nuclear reaches. It is
immune to being slowed by a Moderator, moves slowly (speed 28) and leaks `12`
integrity.

Cracking it is a fission chain rather than a health bar. Breaking the containment
pool exposes the nucleus, which carries on as the isotope it already is. From
there each decay step emits the next entry in its chain onto the path and
transmutes the nucleus into a lighter one, and when its shells are finally spent
the core bursts, emitting every remaining step at once. The chain is `55` steps
and emits three kinds of matter:

| Emission | What it is                                      | Total shells |
| -------- | ----------------------------------------------- | ------------ |
| Alpha    | a full `6`-electron atom                        | 6            |
| Beta     | a light `2`-electron atom                       | 2            |
| Daughter | a lighter but still radioactive Isotope         | 23           |

It sheds `6` daughters, `17` alphas, and `32` betas. The daughters are the point:
each is a full Isotope in its own right, energy-immune and decaying into its own
alpha and beta particles, so the board has to hold a kinetic/nuclear line against
a fission cascade while the strippers behind it clear a flood of loose particles.
Total shells `616`: pool `180`, nucleus `132`, and `304` across everything it
sheds.

## Wave composition

A round is a timed sequence of units released from the inlet(s) and distributed
across the map's paths (`specs/board.md`). Each round's composition is fixed by
the round table below; implement it exactly as written.

### The round table

Each row lists the round's groups in release order. `Atom(n)` is a regular atom
of `n` electrons. A count is the number of units of that group spawned, not the
number of pops it produces: a cluster or an isotope fragments, so one spawned
Polymer becomes several units the board must finish.

| Round | Composition                                                              |
| ----- | ------------------------------------------------------------------------ |
| 1     | 20 Atom(1)                                                               |
| 2     | 35 Atom(1)                                                               |
| 3     | 25 Atom(1), 5 Atom(2)                                                    |
| 4     | 35 Atom(1), 18 Atom(2)                                                   |
| 5     | 5 Atom(1), 27 Atom(2)                                                    |
| 6     | 15 Atom(1), 15 Atom(2), 4 Atom(3)                                        |
| 7     | 20 Atom(1), 20 Atom(2), 5 Atom(3)                                        |
| 8     | 10 Atom(1), 20 Atom(2), 14 Atom(3)                                       |
| 9     | 30 Atom(3)                                                               |
| 10    | 102 Atom(2)                                                              |
| 11    | 10 Atom(1), 10 Atom(2), 12 Atom(3), 3 Atom(4)                            |
| 12    | 15 Atom(2), 10 Atom(3), 5 Atom(4)                                        |
| 13    | 50 Atom(2), 23 Atom(3)                                                   |
| 14    | 49 Atom(1), 15 Atom(2), 10 Atom(3), 9 Atom(4)                            |
| 15    | 20 Atom(1), 15 Atom(2), 12 Atom(3), 10 Atom(4), 5 Atom(5)                |
| 16    | 40 Atom(3), 8 Atom(4)                                                    |
| 17    | 12 Atom(4)                                                               |
| 18    | 80 Atom(3)                                                               |
| 19    | 10 Atom(3), 9 Atom(4), 15 Atom(5)                                        |
| 20    | 6 Dimer                                                                  |
| 21    | 40 Atom(4), 14 Atom(5)                                                   |
| 22    | 16 Dimer                                                                 |
| 23    | 14 Dimer                                                                 |
| 24    | 20 Atom(2), 1 Noble(3)                                                   |
| 25    | 25 Atom(4), 10 Dimer                                                     |
| 26    | 23 Atom(5), 4 Isotope                                                    |
| 27    | 100 Atom(1), 60 Atom(2), 45 Atom(3), 45 Atom(4)                          |
| 28    | 6 Isotope                                                                |
| 29    | 65 Atom(4)                                                               |
| 30    | 9 Isotope                                                                |
| 31    | 16 Dimer, 10 Isotope                                                     |
| 32    | 45 Dimer                                                                 |
| 33    | 20 Noble(1), 13 Noble(4)                                                 |
| 34    | 160 Atom(4), 6 Isotope                                                   |
| 35    | 35 Atom(5), 55 Dimer, 5 Polymer                                          |
| 36    | 140 Atom(5), 20 Noble(3)                                                 |
| 37    | 50 Dimer, 7 shielded Dimer, 25 Isotope                                   |
| 38    | 42 Atom(5), 17 Dimer, 24 Isotope, 2 Lattice                              |
| 39    | 20 Dimer, 20 Isotope, 20 Polymer                                         |
| 40    | 1 Macromass                                                              |

Round 40 is the Macromass alone (The boss, above): a single unit, and the whole
round.

### Release timing

Groups are released in the order the table lists them, one group at a time. A
group's units are released back to back at a fixed interval for their type, so
matter arrives in runs of one kind rather than interleaved, and the fragments of
a cluster or isotope group overlap into a sustained spray:

| Group type       | Interval between units |
| ---------------- | ---------------------- |
| Atom             | 90 ms                  |
| Noble            | 110 ms                 |
| Dimer            | 320 ms                 |
| Chelate          | 340 ms                 |
| Polymer          | 420 ms                 |
| Lattice          | 520 ms                 |
| Isotope, Shroud  | 500 ms                 |
| Macromass        | 1500 ms                |

Successive groups are separated by a `900 ms` gap. If a round's total release
span computed this way is under `22 s`, scale every interval in that round up by
the single factor that brings the span to `22 s`, so the opening rounds arrive at
a readable pace rather than all at once.

Within a group, units are distributed across the map's paths in rotation, so on
a multi-path map every path receives the same kind of matter at the same time
(`specs/board.md`).

### What each round asks of the board

Reading the next-round preview (`specs/board.md`, `specs/campaign.md`), which
names each coming type and what it asks of the board (detect / kinetic-nuclear /
chip-bonds), and re-shaping the board for it is the between-round game.

Because fragments continue on their path, a cluster or heavy that is only partly
broken down still sends its pieces onward. A Polymer that slips the openers
arrives as an intact cluster the strippers cannot finish in time, and leaks. The
pressure is always to open each unit up before it reaches the collector.
