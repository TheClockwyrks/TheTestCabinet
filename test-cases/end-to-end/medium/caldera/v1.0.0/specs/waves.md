# Caldera — The wave loop, escalation, and winning

This file defines the heart of play: the discrete numbered **waves**, how the Slag
assault **escalates** by composition and tier as the run wears on, the wave cadence
and population caps, the score, and how the run is **won or lost**. It builds on the
world in `specs/world.md`, the Slag in `specs/enemies.md`, and the towers and economy
in `specs/towers.md` and `specs/build.md`. All times are seconds of real,
frame-rate-independent simulation time (`specs/overview.md`); the **shape** of the
escalation is the requirement.

## The loop, in one paragraph

The run is a fixed series of **numbered waves**. Before each wave a short **build
interval** counts down, during which you extend your fluid network, place and upgrade
towers, and decide whether to bank funds or **upgrade the Core**. Then the wave
arrives: the Slag spawn at the **two breaches** (`specs/world.md`) and assault the
Core and your network. You build **at any time**, during a wave as well as between
(`specs/build.md`). Clear the **final wave** — survive it with the Core still
standing — and the caldera **holds**: you win. If the Core's health reaches `0` at
any point, you are **overrun**: you lose.

## Waves and cadence

- The run is **`15` waves** (`N`). The HUD shows the current wave and the
  count (`WAVE 6 / 15`) and, during a build interval, a **countdown** and a **preview
  of the next wave's composition** (`specs/flow.md`).
- **Build intervals.** A long **`60 s`** setup interval precedes wave 1; between waves
  the interval is about **`25 s`**, tightening toward **`18 s`** in the late run.
  The interval is a safe prep window, not a build lock — building continues
  during waves.
- **A wave** is a bounded group of Slag, released from **both breaches** over a few
  seconds (spread across the two approaches, not a single-file line). Wave **size**
  grows over the run — from about **`6` units** at wave 1 to about **`30`** at wave 15
  — but escalation leans on **quality (tier)** first, not just quantity.
- **Live-population cap.** At most about **`50`** Slag may be alive at once
  (`specs/overview.md`). If a wave would exceed the
  cap, hold the remainder until units die; the field stays dense but bounded.
- The **next** wave's build interval begins when a wave is **cleared** (all its Slag
  destroyed); the run does not start the next wave while the previous one is still on
  the field.

## Escalation — curve-driven, easy first

The assault opens easy and ramps. There are **no phases** — instead, two schedules,
both keyed on the **wave number**, shift what spawns. This is the one lever that makes
the run harder over time; nothing is tied to the Core's health.

### 1. Composition curve — which archetypes spawn

Each archetype's share of a wave shifts over the run, so tougher archetypes **phase
in** by probability rather than at a hard gate. Illustrative (for `N = 15`):

| Wave band | Runner | Breaker | Sapper | Colossus |
| --- | --- | --- | --- | --- |
| 1–3 | `100%` | — | — | — |
| 4–6 | `70%` | `30%` | — | — |
| 7–9 | `45%` | `35%` | `20%` | — |
| 10–12 | `30%` | `35%` | `30%` | `5%` |
| 13–15 | `20%` | `30%` | `30%` | `20%` |

So **Runners** carry the opening, **Breakers** join around wave 4, **Sappers** around
wave 7 (the network becomes a target you must defend), and the **Colossus** appears in
the last band as the headliner. Both breaches draw from the same schedule.

### 2. Tier curve — how tough each unit is

Whatever archetype is rolled, its **tier** (`specs/enemies.md`) rolls from a schedule
that ramps toward Tier III. Illustrative:

| Wave band | Tier I | Tier II | Tier III |
| --- | --- | --- | --- |
| 1–3 | `100%` | — | — |
| 4–7 | `60%` | `40%` | — |
| 8–10 | `25%` | `55%` | `20%` |
| 11–13 | — | `45%` | `55%` |
| 14–15 | — | `15%` | `85%` |

The **shape is required**: the run opens **100% Runner /
Tier I** (easy), tougher archetypes and tiers ramp in, there is a **mixed middle band**
where several archetypes and all three tiers can appear, and the run ends on a
**Tier-III-dominant final surge** (wave 15) — a heavier, escorted push with Colossi and
Breakers at Tier III that a well-built defense can still break.

### Balance — winnable, not a spiral

Unlike a pure-survival siege, Caldera is **won or lost**. Balance the escalation, Core
and structure health, Slag stats, and the economy so that:

- a **well-played, well-supplied** defense — reaching water and vents early, covering
  both approaches, mixing towers to the terrain and the roster, and timing the Core
  upgrade — can **hold through wave 15** with the Core surviving; while
- a **sloppy** defense — leaving an approach open, letting a Sapper black out a flank,
  neglecting anti-armor for the Breakers and Colossi, or over-investing in the Core
  upgrade before a wave — **loses the Core**.

The Core's health does not regenerate (`specs/world.md`), so damage taken is
permanent — every Slag that reaches it costs you, and the question across the run is
whether your defense stops enough of them.

## Score

- A **survival clock counts up** from `0:00` when the run begins, in `M:SS`, shown on
  the HUD (`specs/flow.md`).
- A **kill counter** tallies Slag destroyed (`specs/enemies.md`).
- On an end, the run records its **result** (held / overrun), the **wave reached**
  (the wave cleared on a win, or the wave the Core fell on), the **Slag destroyed**,
  the **time**, and the **funds** earned, all shown on the end screen (`specs/flow.md`).

## Starting wave — jumping ahead

From the title screen, **PLAY** opens a **starting-wave** prompt (`specs/flow.md`):
begin at **wave 1**, or **skip ahead** to a later wave (for example a mid wave or a
late wave) to face the harder compositions directly. Starting at a later wave:

- sets the composition and tier schedules to that wave from the first second (so the
  opener is representative of that point in the run, never Tier I at a late start), and
- grants a **larger starting treasury** and a **head-start build interval** scaled to
  the skipped waves, so the defense is not expected to be built from `$600` against a
  late-wave assault. (Choose a sensible scaling — for example the funds a patient
  player would have banked by then — the requirement is that a late start is *playable
  and fair*, not that it reproduces an exact economy.)

The survival clock and the displayed kill counter still start at `0`. This lets a
player — or a viewer — jump straight to the tougher late content without first
playing the openers. Whichever wave you start on, the run still ends at the fall of the
Core (overrun) or the clearing of wave `N` (held).
