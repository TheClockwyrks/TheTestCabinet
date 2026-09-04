## Overview

**Wireworm** is a fixed-shooter arcade game for the browser, played on a circuit
board. A segmented data-worm winds down the board through a field of capacitor
nodes while you, a defrag cursor pinned to a shallow band along the floor, fire
upward to cut the worm apart before it reaches you.

Its defining idea is the charged field. Every node the worm is turned by gains
charge, so the collisions that steer the worm also arm the terrain it steers on.
Shoot a fully charged critical node and it detonates a chain-arc that leaps
through the whole charged cluster around it, clearing those nodes and frying any
worm segments caught in the arc. But the board fights back: every segment you
shoot leaves a fresh node behind, so the field thickens as you fight, and a
thicker field steers the worm down at you faster. A standing critical node is a
dive lane that fast-tracks the worm straight into your band. The game is the tug
between letting the field build so you can clear it in one great discharge and
not letting it run you over.

Three support foes press the same idea from different sides: a glitch that
skitters the lower board eating your nodes and defusing the charge you were
saving, a packet-dropper that reseeds terrain whenever you clear too much, and a
corruptor that crawls a row across the upper board and slams every node it
crosses straight to critical. A run is twelve levels down the one board, with
three lives and a field that carries over from each level to the next, so the
board you finish one level on is the board you begin the next on.

Wireworm is inspired by classic fixed-shooter arcade games but is entirely its
own, with an original name, look, charged-node discharge and data-worm. The fight
here is about pacing charge across the board, not just shooting what descends.

## Why it is a benchmark

Wireworm is a large build for an easy case, and its size is in breadth rather
than in any one hard problem. Nothing in it needs physics, an opponent to model,
or a figure tuned by feel: every rule is stated over a `40 x 20` grid. What it
asks for is a lot of exact rules holding at once.

- A worm that steps on its own clock, winds a tile field, drops when it is
  blocked, oscillates at the floor, dives on a critical node, and splits into
  two independent worms when a bolt takes a segment out of its middle.
- A charge model in four states, with a chain-arc discharge that floods the
  connected charged cluster, refuses to conduct through an inert node, detonates
  each node at most once, and fries the worm segments inside its reach.
- A field that grows from the player's own fire and persists across levels, so
  difficulty compounds from how the last level was played.
- Three foes with distinct motion, distinct effects on the field and distinct
  level gates, one of which takes two bolts and falls faster after the first.
- A band-bound cursor, a twelve-level run with a win and a loss, six screens, a
  HUD and ten audio cues.

Every one of those is stated exactly and checked exactly, so a build that is
nearly right in many places is told apart from one that is right.

## What a model is given

A run receives the self-contained specification, the seeded sprite art the game
draws its nodes, worm, cursor and foes from, and a configured TypeScript project
to build inside: the Vite, Vitest, ESLint and Prettier toolchain, and the page
with its canvas. How much more it receives depends on the engine the run selects.
On an engine run the project also carries the runtime and the case-owned modules
that name every figure the specification fixes and stand the engine up, and the
run writes the game and its debug surface against them. On an engineless run the
project carries no source at all, and the run writes the runtime as well as the
game.

The specification fixes the board geometry, the charge model, the discharge, the
worm, the foes, the scoring and the screens exactly. The art is supplied, and the
palette, the type, the glow, the HUD layout and everything else about the look
are left to the build. Every review point is decided by a validator derived from
those rules, and the reviewer's judgement goes into the per-domain ratings of
visuals, polish and feel.
