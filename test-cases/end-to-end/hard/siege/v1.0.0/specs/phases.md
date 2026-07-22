# Siege — The survival loop, phases, and escalation

This file defines the heart of the game: the count-up survival clock, how a
redoubt is ground down and lost, how the assault escalates through phases
A → B → C, and how a siege ends. It builds on the world in `specs/world.md`, the
units in `specs/combat.md`, and the behaviors in `specs/ai.md`. All times are in
seconds of real, frame-rate-independent simulation time (`specs/overview.md`).

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
  coming, on a cadence that tightens with elapsed phase time (below).
- **Artillery** — from phase B onward (`specs/combat.md`), arcing shells that
  bombard both the player (as a nuisance, forcing you to move — see below) and the
  active redoubt directly, chipping its health from range.

**Invariant:** the active redoubt's health trends **strictly downward** under
sustained assault. No defense — however skilled, however many breakers you kill —
can hold a redoubt indefinitely. Two independent pressures guarantee this: the
**breaker (and, from phase B, artillery) cadence tightens with elapsed phase
time**, which sets a rising floor on how fast the redoubt loses health no matter
how the player fights; and as your **kill count** climbs, breakers spawn at higher
**tiers** and each hit lands harder (below). A build in which a well-played
redoubt can be held forever is **wrong**: every redoubt must fall in bounded time,
so every siege ends.

As a target, an unpressured redoubt should still take a couple of minutes of
sustained assault to fall (it is not a soft target that pops in seconds), and a
poorly defended one falls faster. Balance breaker spawn cadence, breaker damage, and
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
later, with a longer survival time. A viewer can also **start a siege at any
phase** (via **PLAY** on the title screen, below) to see that phase directly.

### Escalation — tiers driven by your kill count

The assault gets harder first by **quality**, not quantity. Each attacker archetype
(`specs/combat.md`) comes in three visually distinct **tiers** — the same
silhouette re-plated in a tier accent color, each tier tougher, better-armored, and
hitting harder. The tier a unit **spawns at is driven by your running kill count**,
**not** by elapsed time and **not** by the redoubt's remaining health. This is
deliberate: the harder tiers exist to keep the pressure — and the redoubt damage —
rising as you clear the field, so thinning a wave is answered by tougher
replacements rather than by the fight going quiet.

Define the tier a spawning unit rolls from a **kill-count schedule**. Let `E` be
the **escalation count** — the run's cumulative Scourge kills (the HUD kill
counter) plus a **starting-phase offset** (`0` starting at A, `80` at B, `140` at
C; see below) — and let `N = 200`. At each spawn, roll the unit's tier
from these probabilities, which vary with `E`:

| Escalation count `E` | P(Tier I) | P(Tier II) | P(Tier III) |
| --- | --- | --- | --- |
| `0` | `100%` | `0%` | `0%` |
| `≈ 40` | `67%` | `33%` | `0%` |
| `≈ 80` | `33%` | `67%` | `0%` |
| `≈ 100` | `17%` | `66%` | `17%` |
| `≈ 120` | `0%` | `67%` | `33%` |
| `≈ 160` | `0%` | `33%` | `67%` |
| `≥ 200` (`N`) | `0%` | `0%` | `100%` |

The curve **must** have these properties: it starts
at **100% Tier I** at `E = 0`; **Tier II ramps in** as `E` rises; there is a
**middle band where all three tiers can spawn** (Tier I fading out while Tier III
fades in, around `E ≈ 80`–`120` above); and at **`E ≥ N` it is 100% Tier III**. A
straightforward way to get this: Tier I's share falls linearly from `1` at `E = 0`
to `0` at `E = 120`; Tier III's share rises linearly from `0` at `E = 80` to `1` at
`E = N`; Tier II takes whatever is left. Because the schedule keys on kills, later
phases (reached with a higher kill count) naturally field tougher tiers, and a
siege **started** at phase B or C opens at a representative mid-tier via its offset
(`80` → mostly Tier II; `140` → a Tier II/III mix), never at Tier I.

Wave **size and cadence** are a secondary lever, kept bounded so the renderer holds
its frame rate (`specs/overview.md`) — escalate through **tier** first, not by
flooding the field with bodies:

- **Infantry waves.** A wave is a small **mixed group of `5`–`8` attackers**
  (Rushers and Gunners, at whatever tiers the schedule rolls). Waves arrive about
  **every 12 s** at a phase's open, tightening toward a **6 s** floor as the phase
  wears on — never faster than the floor.
- **Live-population cap.** At most about **40** Scourge attackers may be alive at
  once. If a wave would exceed the
  cap, hold it until units die. The field stays dense but bounded; population never
  grows without limit.
- **Breakers** spawn on their **own** cadence (they still count toward the cap):
  about **one every 20 s** at a phase's open, tightening toward **one every 12 s**.
  This time-based tightening is the redoubt's clock (see the invariant above);
  their tier — and so their per-hit redoubt damage — rises with your kill count.

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

Carried-over archetypes keep appearing (and keep climbing tiers as your kill count
rises); the newly introduced archetype is the headline threat of the phase. Full
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

## Starting phase

After choosing **PLAY** on the title screen the player picks a **starting
phase** — **A**, **B**, or **C** — before dropping into the game (`specs/flow.md`;
the class is chosen separately, on the in-game spawn UI):

- Starting at **A** is a full siege from the front, tier schedule opening at Tier I
  (escalation offset `0`).
- Starting at **B** or **C** drops you straight into that phase: the redoubts
  forward of it are already fallen, the spawn line and respawn points are set to
  that phase, that phase's full roster (its newly introduced archetype included) is
  active immediately, the tier schedule opens at a representative mid-tier via its
  **escalation offset** (`80` for B, `140` for C — see the tier schedule above)
  rather than at Tier I, and you begin with a **full four-Warden squad**. The
  survival clock still starts at `0:00`, and the displayed kill counter still
  starts at `0` (only the tier schedule's escalation count carries the offset).

This lets a player — or a viewer — jump directly to the tougher, later content
without first surviving the earlier phases. Whichever phase you start in, the
siege still runs from there to the fall of C.
