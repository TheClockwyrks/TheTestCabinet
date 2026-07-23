**Valence** is a chemistry-themed tower-defense game. Unstable matter streams
from an inlet along a fixed path toward a collector, and you defend it by freely
placing towers beside the path, Bloons-style, to break the matter down before it
escapes. You pick a map at the start: an easy single path, a medium branching
fork of lanes, or a hard set of multiple separate paths, some curved and some
straight with right-angle corners.

Its defining idea is that matter is hit points, damage types, and stackable
traits, not a "pop a layer" ladder where each form has exactly one counter.
Every unit carries electron shells (its hit points), and any of three damage
types (energy, kinetic, and nuclear) strips them; a unit's traits decide which
damage reaches it, opening it to a whole class of towers rather than just one. A
bonded cluster wraps its atoms in an outer bond pool that any tower chips through
(kinetic fastest), shedding a spray of free atoms. A heavy is a radioactive
isotope, immune to energy and cracking only under kinetic or nuclear damage, and
it decays as it is worn down, shedding alpha and beta particles. An inert unit is
untargetable until a detector reveals it. Traits stack late, so a cloaked heavy
or a bonded cloak forces layered defenses.

Seven general-purpose towers each deal a damage type and each choose one of two
upgrade branches; two are support auras, a Catalyst that reveals and excites and
a Moderator that slows. The round campaign escalates to a fragmenting boss.

As a full-stack case, the model under test produces the game's own assets during
the run: the atom, cluster, heavy, inert, and boss sprites, the orbiting-electron
and boss animations, the seven tower sprites across their tiers and branches, the
damage-type-colored projectiles, the live particle bursts, and the sound and
reactor music. The six asset-generation tools sit on the run image's `PATH`, and
the model builds the game around what it makes. Valence is inspired by
lane-defense games but is entirely its own: an original name, an atomic-diagram
look, the damage-type and trait model, and its own matter and towers.
