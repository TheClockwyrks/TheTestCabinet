# Siege — The survival loop, phases, and escalation

This file defines the heart of the game: the count-up survival clock, how a
redoubt is ground down and lost, how the assault escalates through phases
A → B → C, and how a siege ends. It builds on the world in `specs/world.md`, the
units in `specs/combat.md`, and the behaviors in `specs/ai.md`. All times are in
seconds on the fixed timestep from `specs/overview.md`.

## The loop, in one paragraph

You defend the **active redoubt**. The Scourge spawns in escalating waves and
attacks it; the redoubt has a health pool and **no way to repair it**, so it is
always losing ground. When the active redoubt's health reaches zero it **falls**:
you fall back to the next redoubt, the spawn line advances, and the Scourge comes
harder. When the **last redoubt (C) falls, the siege is over** — there is no
victory condition. You are playing to **survive as long as possible** and destroy
as many attackers as you can. It is a fighting retreat you will ultimately lose;
the question is how well.

## The survival clock and score

- A **survival clock counts up** from `0:00` the moment the siege begins, in
  `M:SS`, shown on the HUD (`specs/flow.md`). It only ever increases — losing a
  redoubt does **not** subtract or reset it.
- A **kill counter** counts Scourge units you and your squad destroy.
- When the siege ends, the run's **score is its final survival time** (primary)
  and **total kills** (secondary); both are shown on the defeat screen
  (`specs/flow.md`). There is no win — every siege ends in defeat, sooner or
  later.

## Redoubts fall by damage, and always eventually fall

A redoubt is a **health-based** objective (`specs/world.md`): the Scourge reduces
its health, and at `0` it falls. Standing on or near a redoubt does **not** block
this — you slow it only by **destroying the attackers dealing the damage**. Two
mechanisms drive a redoubt's health down, and together they guarantee it falls no
matter how well you play:

- **Breakers** — a dedicated Scourge sapper (`specs/combat.md`) that **ignores you
  and your squad entirely** and marches straight for the active redoubt to attack
  it at melee range. Breakers are the primary way the redoubt loses health. They
  are heavily armored and slow; you can kill them to buy time, but more keep
  coming, on a cadence that tightens as the phase wears on (below).
- **Artillery** — from phase B onward (`specs/combat.md`), arcing shells that
  bombard both the player (as a nuisance, forcing you to move — see below) and the
  active redoubt directly, chipping its health from range.

**Invariant:** the active redoubt's health trends **strictly downward** under
sustained assault. No defense — however skilled, however many breakers you kill —
can hold a redoubt indefinitely, because the breaker cadence tightens and their
per-hit damage escalates by tier faster than a player can fully suppress them. A
build in which a well-played redoubt can be held forever is **wrong**: every
redoubt must fall in bounded time, so every siege ends.

As a target, an unpressured redoubt should still take a couple of minutes of
sustained assault to fall (it is not a soft target that pops in seconds), and a
poorly defended one falls faster. Tune breaker spawn cadence, breaker damage, and
artillery so a redoubt held by an attentive player and a full squad still falls
within roughly **2–4 minutes** of becoming active, and faster when the defense
thins.

## Phases: A → B → C

The siege runs through three **phases**, one per redoubt, always in order. The
phase is simply **which redoubt is currently active**:

1. **Phase A** — defend redoubt A. The spawn line is at the far edge
   (`specs/world.md`).
2. **Phase B** — begins the instant A falls. The front falls back to redoubt B,
   the spawn line advances, your respawn point moves back (`specs/world.md`), your
   squad reconstitutes at the new line (`specs/ai.md`), and a new attacker
   archetype joins the assault (below).
3. **Phase C** — begins when B falls. The last stand at redoubt C, the toughest
   roster.

When **C falls**, the siege ends → the **defeat** state (`specs/flow.md`).

Because the redoubt always falls, **every siege progresses through the phases in a
single run** regardless of skill — a strong defender simply reaches each phase
later, with a longer survival time. A reviewer can also **start a siege at any
phase** from the deploy screen (below) to see that phase directly.

### Escalation within a phase — tiers (quality), then cadence

A single phase lasts a few minutes and must get harder as it runs — and it does so
first by **quality**, not just quantity. Each attacker archetype
(`specs/combat.md`) comes in three visually distinct **tiers** — the same
silhouette re-plated in a tier accent color, each tier tougher, better-armored, and
hitting harder — and the tier a unit **spawns at climbs with elapsed phase time**:

- A phase **opens** spawning its attackers at **Tier I**, works up to **Tier II**
  around its midpoint, and reaches **Tier III** late, as the redoubt nears falling.
- So the same wave of Rushers and Gunners becomes a wave of plated, then elite
  ones: a phase escalates in **character**, not just volume. This is the point of
  tiers — within-phase difficulty is **quality-driven**, so a phase gets
  meaningfully harder without simply flooding the field with more bodies.
- A later phase may bias this ramp upward so the fight never feels easier than the
  phase before it, and a siege **started** directly at phase B or C (deploy choice
  below) opens at a representative mid-tier, not Tier I.

Spawn **cadence and count** tighten over a phase as a secondary lever: infantry
waves start about **8 s** apart and tighten toward a **3 s** floor, and **breakers**
spawn from about **one every 24 s** toward **one every 10 s**, so redoubt damage
accelerates the longer a phase runs (this is what carries the redoubt down — see
above). But keep the live on-screen count within what the renderer can sustain
(`specs/overview.md`): escalate a phase through **tier** first and cadence second,
not by letting the population grow without bound.

### Escalation between phases — new units

Falling back to a new redoubt is not just the same fight one notch up — each phase
**introduces a new attacker archetype** the earlier phases never fielded, so *what*
you must answer changes, on top of the new redoubt having more health
(`specs/world.md`):

| Phase | Attackers in play | New this phase |
| --- | --- | --- |
| **A** | Rushers, Gunners, Breakers | — (the core assault) |
| **B** | + **Artillery** | Arcing bombardment begins (`specs/combat.md`). |
| **C** | + **Ravagers** | Heavy elite bruisers that wade into the Wardens. |

Carried-over archetypes keep appearing (and keep climbing tiers within the new
phase); the newly introduced archetype is the headline threat of the phase. Full
stats for every archetype and tier are in `specs/combat.md`. The roster stays
small — a handful of archetypes, each re-skinned across three tiers rather than
multiplied into many models — but it **grows** as the siege deepens.

## Respawning

- **You respawn.** On death, after a **5 s** delay, you respawn at the player
  respawn point behind the active redoubt (`specs/world.md`) at full health with
  your loadout. The redoubt keeps taking damage while you are down — dying costs
  the defense.
- **Your squad respawns** on a **longer** timer (`specs/ai.md`), so losing a squad
  member hurts for a while but is not permanent.
- There is **no lives limit** — respawns are unlimited. The siege ends only when
  redoubt C falls, never because you ran out of lives.

## Starting phase (deploy choice)

On the **deploy** screen (`specs/flow.md`) the player chooses a **starting
phase** — **A**, **B**, or **C** — as well as a class:

- Starting at **A** is a full siege from the front.
- Starting at **B** or **C** drops you straight into that phase: the redoubts
  forward of it are already fallen, the spawn line and respawn points are set to
  that phase, that phase's full roster (its newly introduced archetype included) is
  active immediately with the tier ramp opening at a representative mid-phase level
  rather than Tier I, and you begin with a **full four-Warden squad**. The survival
  clock still starts at `0:00`.

This lets a player — or a reviewer — jump directly to the tougher, later content
without first surviving the earlier phases. Whichever phase you start in, the
siege still runs from there to the fall of C.
