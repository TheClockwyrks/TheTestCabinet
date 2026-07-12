**Valence** is a chemistry-themed tower-defense game. Unstable matter streams out of
an inlet and flows along a fixed path toward a collector; you pick a **map** at the
start — an easy single path, a medium **branching** fork of lanes, or a hard set of
**multiple separate paths** (some maps curved, others straight with right-angle
corners) — and defend it by **freely placing** **towers** beside the paths, Bloons-style,
to break the matter down before it escapes.

Its defining idea is that matter is **hit points, damage types, and stackable traits** —
not a "pop a layer" ladder where each form has exactly one counter. Every unit carries
electron **shells** (its hit points), and any of three damage types — **energy**,
**kinetic**, **nuclear** — strips them; a unit's **traits** decide which damage reaches
it, and a trait opens a unit to a *class* of towers, never just one. A **bonded** cluster
wraps its atoms in an outer **bond pool** that *any* tower chips through (kinetic fastest),
shedding a spray of free atoms. A **heavy** is a **radioactive isotope**, immune to energy
and cracking only under **kinetic or nuclear** damage — several towers can — that **decays**
as it is worn down, shedding alpha and beta particles. An **inert** unit is untargetable
until a **detector** reveals it, and detection comes from several sources. Traits **stack**
late — a cloaked heavy, a bonded cloak — forcing layered defenses. Seven **general-purpose**
towers each deal a damage type and each choose one of two **upgrade branches**; two are
support auras — a **Catalyst** reveals and excites, a **Moderator** slows — across an
escalating round campaign that ends in a fragmenting boss.

Valence is also a **full-stack** case: the model under test must **produce the game's
own assets during the run** — the atom, cluster, heavy, inert, and boss sprites, the
orbiting-electron and boss animations, the seven tower sprites across their tiers and
branches, the damage-type-colored projectiles, the live particle bursts, and the sound
and reactor music — with the six asset-generation tools on the run image's `PATH`, and
then build the game around them. It is inspired by lane-defense games but is entirely its
own: an original name, an atomic-diagram look, the damage-type/trait model, and its own
matter and towers.
