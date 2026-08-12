---
title: "Foray — overview"
---

Foray is an [adversarial](/testing/adversarial/overview/) test case: a
territorial maze-raiding contest between two teams of three agents. The model
writes the controller that drives one team, a classical-AI problem with no model
in the loop once the controller is compiled.

This page documents the rules of the game. The supporting code is covered in
[Game code and replay](/testing/adversarial/foray/architecture/), the baseline
controllers in [Reference controllers](/testing/adversarial/foray/references/),
and the art in [Visual assets](/testing/adversarial/foray/assets/). The on-disk
slug is `foray`.

Foray takes its base loop from the UC Berkeley CS188 "Pacman Capture-the-Flag"
contest, the canonical classical-AI adversarial assignment. It then changes two
rules (see [Rule changes](#rule-changes)) so that optimal play under Foray's rules
differs materially from the original contest and a published CTF strategy is not
enough to win.

## The world

Two ant colonies, Red in the west and Blue in the east, share one
mirror-symmetric maze of dug tunnels split down the centre by a contested
no-man's-land. Every wall, tunnel, seed cache, large seed, and jelly node on one
side has a mirror twin on the other, so neither colony starts with a structural
advantage.

Movement is tile-locked. Each agent occupies one tile and on each tick moves one
tile north, south, east, or west, or holds with `Stop`. Walls block movement and
two agents may share a tile. The one cancelled move is the tag-dodging swap, a
soldier and an enemy raider exchanging tiles in one tick. That pair is then
treated as having met, and the tagging rule settles it. Every other head-on swap
resolves normally.

The map is laid out around four fixtures:

- Nests. Each colony has a spawn nest against its back wall. Agents start there
  and respawn there.
- Seed caches. The ordinary scorable resource, seeded across each colony's home
  half and mirrored between the two halves. Each is worth 1 and is consumed when
  a raider eats it.
- Large seeds. Worth and weighing three ordinary seeds. They are the only fixture
  that moves (see [Rule changes](#rule-changes)).
- Royal jelly nodes. A small number of power nodes per half (see
  [Rule changes](#rule-changes)).

## Border roles

The role flip is the core rule, and it makes every agent both an attacker and a
defender:

- An agent standing on its own half is a soldier, a defender.
- An agent standing on the enemy half is a raider, a forager. A raider eats the
  enemy's seeds and carries them.

An agent's role follows from which half it currently stands on, so crossing the
border flips it. A team's three agents are not typed: the controller decides,
tick by tick, who pushes across to raid and who stays home to defend.

## Eating, carrying, banking

A raider that steps onto an enemy seed cache eats it, adding 1 to its load.
Stepping onto an enemy large seed picks it up whole, adding 3. Carried seeds are
not yet scored.

A raider banks its load by carrying it back across the border onto its own half.
The instant it crosses, its entire load is added to the team's score and its load
resets to zero. A raider tagged before banking scores nothing for what it was
carrying.

Banking is settled before tagging within a tick, so an agent that crosses with a
load has already scored by the time an enemy on the landing tile can act.

## Tagging and respawn

Two enemies meet when they share a tile, or when they try to trade tiles in one
tick. Because a role is decided purely by which half a tile is on, a meeting is
always one soldier against one enemy raider. What happens turns only on royal
jelly:

- Neither is immune: the soldier tags the raider. Home turf wins.
- Exactly one is immune: the immune one tags the other, whichever it is.
- Both are immune: nothing happens.

An immune ant therefore cannot be killed, and it kills any non-immune enemy it
meets. A soldier standing at home is reachable by an enemy raider running jelly.

A tagged ant respawns at its nest. A tagged raider also drops what it held: its
ordinary seeds scatter at the tag tile as recoverable caches, and a large seed
drops there intact, still one object worth 3. Defending well therefore hands the
seeds back to your own side.

## Rule changes

Foray changes the levers a published CTF strategy leans on. The changes are
thematically native to ants, and the exact constants are set by the case's rules
configuration (see [The numbers](#the-numbers)).

### Carry weight

A raider's speed degrades with its load, and an unladen raider is slightly faster
than a soldier. That edge is what lets a colony break a defended line at all.

Movement uses a fixed-point speed accumulator. Each agent banks charge per tick
and steps a tile once it has banked a tile's worth, so speeds can be finer than
one tile per tick. A soldier moves a shade under every tick. A light raider,
carrying at most the light-load threshold, moves every tick. Past that threshold
a raider loses charge per extra unit of load, matching the soldier one unit over,
slower by the same margin at two units over, and crawling under a heavy load down
to a floor that never freezes it.

The quantity is load, not the number of objects held. A large seed weighs 3,
exactly what it is worth, so a raider carrying nothing but a large seed is still
light and still outruns every defender. One ordinary seed on top of it drops it
to soldier speed.

Load is therefore both the score and the vulnerability, and when to break off and
bank is a continuous decision. Hoarding makes a raider slow and easy to tag, and
a tagged raider loses everything it was carrying.

### Large seeds

Each half holds a couple of large seeds, worth and weighing three ordinary ones.
They are the only fixture on the board that moves.

A large seed drifts one tile at a time toward the border whether or not anyone is
standing on it, so it cannot be squatted: it walks out from under a defender. It
comes to rest on the last column of its own half, on the seam, one step from an
enemy raider who can take it and bank it by stepping straight home. It never
crosses on its own, so a seed is stolen by a raid rather than conceded by the
clock.

The defence's answer is to recall it: an ant of the seed's own colony stands on
it for a stretch of consecutive ticks and it snaps back to its spawn. That costs
the walk out and the walk back, and an agent spent walking is an agent not
raiding. A seed can be recalled only once it has drifted a few tiles from home,
so a defender can neither pin one on its spawn nor camp the next tile and yo-yo
it back forever.

A raider tagged while hauling one drops it intact at the tag tile, deep in the
defender's own territory, where it starts drifting again. Running down a
large-seed carrier is one of the strongest defensive plays.

### Royal jelly

Eating a royal jelly node grants the eater immunity for a window of ticks. While
it lasts the immune ant cannot be tagged and tags any non-immune enemy it meets,
including a soldier standing on its own half. Immunity is a weapon as much as a
shield.

Jelly answers two problems. It is how a heavy load gets home through a defended
border, and it is how a defender parked on something valuable is broken. A
defender squatting a cache is untouchable until a raider arrives with jelly
running.

A consumed node grows back at the same tile after a respawn window, so jelly is a
renewable resource on a cycle and no defender can hold a position forever.
Immunity travels with the ant rather than the role, so a raider that eats jelly
and runs home is an immune soldier for the rest of its window.

## Winning

A match ends the moment either condition is met:

- Sweep. As soon as one colony has banked the enemy half's full value it has
  stripped the enemy larder and wins immediately, whatever the score on its own
  side. Large seeds count at their full worth, so a sweep requires taking both of
  them.
- Time limit. A match is bounded to 10 minutes of game time. That time is faked,
  fixed-timestep time (see
  [lockstep](/testing/adversarial/overview/#lockstep-simulation-and-replays)), so
  the cap bounds the match deterministically while the match still runs as fast as
  the host can compute it.

If the time limit is reached first, the colony with the higher banked score wins.
An equal banked score is broken by efficiency: the colony whose controller
consumed the least total fuel wins, having reached the same score for less work.
Only a level score and level fuel is a draw. A controller that traps, exhausts
its [fuel or memory](/testing/adversarial/overview/#sandbox-and-execution), or
emits a contract-invalid action forfeits the match.

## The numbers

The shipped values, which are part of the game definition rather than levers a
model may change:

| Quantity | Value |
| --- | --- |
| Board | `32 × 16`, border between columns 15 and 16 (`border_x = 16`) |
| Agents per side | 3 (ids 0–2) |
| Ordinary seed caches per half | 14, worth 1 each |
| Large seeds per half | 2, worth and weighing 3 each |
| Total value per half | 20 |
| Royal jelly nodes per half | 2 |
| Movement resolution | 8 charge per tile |
| Soldier speed | 7 charge per tick, just under one tile per tick |
| Light raider speed | 8 charge per tick, for loads 0–3 |
| Carry penalty | −1 charge per tick per unit of load past 3, floored at 1 |
| Jelly immunity | 40 ticks |
| Jelly respawn | 1,200 ticks, at the same tile |
| Large seed drift | 1 tile per 300 ticks, toward the border |
| Large seed recall | 150 consecutive ticks standing on it |
| Large seed recall guard | at least 3 tiles drifted from spawn |
| Timestep | 16 ms, fixed and faked |
| Max ticks | 37,500, which is 10 minutes of game time |
