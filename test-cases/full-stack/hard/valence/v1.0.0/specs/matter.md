# Valence — Matter and the decomposition model

This file defines the **matter** you defend against — its forms, the specific types and
their stats, the three-axis decomposition model that turns one form into another, and how
a wave is built. It builds on the board and lanes in `specs/board.md`, the towers in
`specs/towers.md`, and the round progression in `specs/flow.md`. Speeds are in logical
pixels per second; energy and integrity values are unitless game numbers.

The stat numbers below are the **base** (Round 1) values and are **fixed**; implement them
exactly as written. Equally important is the **behavior**: the four forms, the three
decomposition axes, inert matter, and how fragments continue.

## The four forms

Every unit is, at any moment, in one of four **forms**, and its form decides which tool
can act on it. A unit's form can **change** as it is broken down (a molecule becomes
atoms; a heavy becomes atoms), which is the heart of the game.

- **Free atom.** A nucleus (colored by its element) surrounded by **electron shells**
  (`specs/overview.md`). A free atom is what an **Ionizer** neutralizes: each ionizing hit
  strips one shell, and an atom stripped to **zero** shells is neutralized and pays its
  energy. Nothing else acts on a free atom.
- **Molecule.** Two or more atoms joined by **bonds** (ball-and-stick). Only a **Shear**
  acts on a molecule: each shearing hit breaks one bond and **peels a free atom off** the
  molecule (below). While an atom is bonded in a molecule its electrons are engaged in its
  bonds, so it **cannot be ionized** — the molecule must be sheared apart first.
- **Heavy nucleus.** A dense, tightly-bound orb with a radioactive shimmer. A heavy is
  **immune to shearing and ionizing**; only a **Fission** tower acts on it, adding to its
  **criticality** until it **splits** into two lighter **daughter atoms** (below).
- **Inert (noble) atom.** A free atom sealed by a **full outer shell** that makes it
  **untargetable by every tower**. A **Catalyst** tower makes an inert atom **reactive**
  (`specs/towers.md`), after which it is an ordinary free atom an Ionizer can strip. An
  inert atom that reaches the collector while still inert leaks normally.

Every unit shows a small **integrity read** appropriate to its form so the player can see
progress: an atom's remaining electron shells (as rings), a molecule's remaining bonds, a
heavy's criticality toward its split. Draw the forms so they are unmistakable at speed
(`specs/overview.md`).

## The three decomposition axes

There are exactly three ways matter is broken down, one per damage tower
(`specs/towers.md`). Each acts on **one form** and does nothing to the others — this hard
separation is the point of the game, and it is what makes the coming round's composition
worth reading.

### Shearing — molecule → atoms (Shear tower)

A **Shear** hit breaks the **leading bond** of a molecule (the bond nearest the atom
furthest along the conduit) and **peels that atom off** as a **free atom**, which
continues on the same lane at its own position (`specs/board.md`). The remainder of the
molecule travels on, one atom shorter. Shearing a molecule down to its **last** atom
leaves that final atom **free**. So a molecule with `k` atoms and `k − 1` bonds takes
`k − 1` shearing hits to fully atomize, releasing `k` free atoms in all — a single
molecule fragmenting into a spray of atoms that ionizers must then finish. Freed atoms are
a little **faster** than the molecule they came from (they carry the molecule's speed plus
a small increment, capped — see the table). Shearing does nothing to a lone atom, an inert
atom, or a heavy nucleus.

### Ionizing — atom → neutralized (Ionizer tower)

An **Ionizer** hit strips **one electron shell** from a **free, reactive** atom. An atom
stripped to **zero** shells is **neutralized**: it is removed and pays its energy
(`specs/flow.md`), with a neutralize burst (`specs/assets.md`). A freshly stripped but not
yet neutralized atom is a little **faster** than before (fewer electrons, more reactive),
so late ionizing is a race. Ionizing does nothing to a bonded atom (inside a molecule), an
**inert** atom (until catalyzed), or a heavy nucleus.

### Fissioning — heavy → daughter atoms (Fission tower)

A **Fission** hit adds **one** to a heavy nucleus's **criticality**. When criticality
reaches the heavy's threshold, the heavy **splits** into **two lighter daughter atoms**
(free atoms, each with a defined shell count — see the table) that continue on the same
lane, plus a **fission flash** (`specs/assets.md`). The daughter atoms are then ordinary
free atoms an Ionizer finishes. Fissioning does nothing to a molecule or a free atom.

## Inert matter and the Catalyst

An **inert** atom is untargetable until a **Catalyst** tower's field makes it **reactive**
(`specs/towers.md`): once reactive it is an ordinary free atom, with the shell count in the
table, that an Ionizer strips normally. A Catalyst does not damage anything; it only opens
inert matter up (and gives reactive matter a small edge, `specs/towers.md`). A defense with
no Catalyst cannot touch inert units at all, and they leak.

## Matter types

The base (Round 1) roster. `Shells` is a free atom's starting electron shells (ionizing
hits to neutralize it); `Atoms/Bonds` is a molecule's atoms and bonds (shearing hits to
atomize it equal the bonds); `Criticality` is a heavy's fission hits to split. Per-round
scaling of these and of counts is in `specs/flow.md`.

| Type | Form | Structure (Round 1) | Speed | Energy | Leak | Counter chain |
| --- | --- | --- | --- | --- | --- | --- |
| **Monatom** | free atom | 2 shells | 55 | 2 | 1 | Ionizer |
| **Swift** | free atom | 1 shell | 110 | 2 | 1 | Ionizer (fast; wants a Moderator) |
| **Dimer** | molecule | 2 atoms, 1 bond; 2 shells each | 50 | 5 | 1 | Shear → 2 atoms → Ionizer |
| **Polymer** | molecule | 4 atoms, 3 bonds; 2 shells each | 40 | 10 | 2 | Shear ×3 → 4 atoms → Ionizer |
| **Noble** | inert atom | sealed; 2 shells when reactive | 65 | 6 | 1 | Catalyst → Ionizer |
| **Heavy** | heavy nucleus | criticality 2 → two 2-shell atoms | 35 | 12 | 2 | Fission → 2 atoms → Ionizer |
| **Macromass** | boss | see below | 28 | 140 | 12 | Fission → fragments → Shear/Ionizer |

- **Monatom** — the baseline free atom; the bulk of the early rounds and the unit ionizers
  are built to eat.
- **Swift** — a fragile free atom at double speed. Swifts blow down a lane before a thin
  ionizer line can strip them, so they punish a defense with no **Moderator** to slow them
  (`specs/towers.md`).
- **Dimer** — the smallest molecule: one shearing hit frees both its atoms. It teaches
  that molecules must be **opened before** they can be ionized — a board of pure ionizers
  cannot touch a Dimer.
- **Polymer** — a four-atom chain: three shearing hits peel it into four free atoms, so a
  single Polymer becomes a **spray** that floods the ionizers downstream. It rewards
  pairing a Shear early with ionizers behind it.
- **Noble** — inert: untargetable until a **Catalyst** makes it reactive, then an ordinary
  two-shell atom. Nobles force the player to budget for catalysis rather than leaning on
  raw damage.
- **Heavy** — a dense nucleus immune to shearing and ionizing: only **Fission** splits it,
  into two daughter atoms the ionizers then finish. A board with no Fission cannot stop
  heavies, which each leak **2** integrity.
- **Macromass** — the **boss** (below).

## The boss — Macromass

A **Macromass** is a huge unstable isotope that anchors the milestone rounds
(`specs/flow.md`). It is a **heavy nucleus** form with a large **criticality** (base
**6**), immune to shearing and ionizing. **Fission** it repeatedly: each time its
criticality crosses a step it **sheds a fragment** — a **Dimer or a pair of free atoms** —
onto its lane while continuing, and when its criticality is finally spent the core itself
splits into a last burst of fragments. So a Macromass is not a single wall of health but a
**fountain of matter**: the fission line cracks the core while the shear and ionizer lines
behind it clean up the stream of Dimers and atoms it throws off. It moves slowly (speed
28), leaks **12** integrity if it reaches the collector, and pays a large energy bounty
(140) plus whatever its fragments pay. It is **immune to being slowed** by a Moderator
(too massive). Its exact fragment schedule across its criticality is yours to tune within
this shape, but it must genuinely **fragment as it is fissioned**, not simply drain a
health bar.

## Wave composition

A round is a timed sequence of units released from the inlet across both lanes
(`specs/board.md`); the exact spawn timing and lane weighting per round is yours to design,
within `specs/flow.md`'s progression. Compose rounds so the player cannot answer everything
with one tower:

- Early rounds are mostly **Monatoms** and **Swifts**, light enough to teach ionizing and
  the need to slow the fast units.
- **Dimers** and then **Polymers** enter as rounds deepen, forcing a Shear line ahead of
  the ionizers so molecules are opened before they arrive.
- **Nobles** begin appearing so the player must field a **Catalyst**, and **Heavies** so
  the player must field **Fission** — each a form no other tower can touch.
- A **Macromass** boss anchors each milestone round (`specs/flow.md`), with the surrounding
  wave growing toward the late game.
- Reading the **next-round preview** (`specs/board.md`, `specs/flow.md`) and re-shaping the
  board for it — a Shear for the molecule round, a Catalyst before the nobles, Fission
  before the heavies — is the between-round game.

Because fragments continue on their lane, a molecule or heavy that is only **partly**
broken down still sends its pieces onward — an un-sheared Polymer that slips past the shear
line arrives at the ionizers as a molecule they cannot touch, and leaks. The pressure is
always to open each form up **before** it reaches the collector.
