**Valence** is a chemistry-themed tower-defense game. Unstable matter streams out of
an inlet and flows along a fixed conduit that forks into two lanes and rejoins before
the collector; you defend it by placing **emitter towers** at the board's fixed nodes
to break the matter down before it escapes.

Its defining idea is a **three-axis decomposition** model that replaces the usual
"pop a layer" ladder. Matter comes in genuinely different forms, each opened by a
different tool: a **Shear** tower snaps the bonds of a **molecule** so it fragments
into its constituent atoms; an **Ionizer** strips a free **atom**'s electron shells
one by one until it is neutralized; and a **Fission** tower is the only thing that
cracks a **heavy nucleus**, splitting it into two lighter daughter atoms. **Inert**
matter is untargetable until a **Catalyst** makes it reactive, a **Moderator** damps
matter to buy time, and neutralizing matter releases the **energy** that funds your
next tower — held against the **integrity** you lose whenever matter reaches the
collector, across an escalating round campaign that ends in a fragmenting boss.

Valence is also a **full-stack** case: the model under test must **produce the game's
own assets during the run** — the atom, molecule, heavy, and boss sprites, the
orbiting-electron and boss animations, the tower sprites across their upgrade tiers,
the live decomposition particle bursts, and the sound and reactor music — with the
six asset-generation tools on the run image's `PATH`, and then build the game around
them. It is inspired by lane-defense games but is entirely its own: an original name,
an atomic-diagram look, the decomposition model, and its own matter and towers.
