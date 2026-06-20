# Spectra — Stages, scoring, lives, states, and HUD

This file defines the wave/stage progression, the challenge stages, scoring,
lives, stage scaling, the game's state machine, the HUD, audio, the behaviors
that make good test targets, and what is out of scope. It refers to the stage in
`specs/playfield.md`, polarity in `specs/polarity.md`, the controls in
`specs/controls.md`, the drones in `specs/enemies.md`, and the modes under
`specs/modes/`.

## Stages and waves

The game is a sequence of **stages**, numbered `STAGE 1`, `STAGE 2`, ... Each
**standard** stage is one **wave**: the formation flies in (`specs/enemies.md`),
the drones assault you, and the stage is **cleared** when **every** drone in the
wave is destroyed. Clearing a stage advances to the next, harder one.

Every **third** stage (`STAGE 3`, `STAGE 6`, `STAGE 9`, ...) is a **challenge
stage** instead of a normal wave (below).

## Challenge stages

A challenge stage is a **non-firing flyover** — a shooting-gallery breather that
still exercises polarity:

- It is announced with a **`CHALLENGING STAGE`** banner, then a fixed sequence of
  **flyover groups** enters. Each group sweeps across the field along set paths
  and **exits**; the drones **never fire**, and contact with them **costs no
  life** during a challenge stage.
- **Single-band groups.** Each group is entirely **one band**, and groups
  **alternate** bands (cyan, then magenta, ...), so you pre-flip to a group's band
  and rake it before the next arrives. Use about **5 groups of 8 drones** (40
  total).
- **Scoring.** Each drone destroyed scores **`100`**. Destroying **all** of them
  earns a **`10000` perfect bonus**; otherwise the score is just the per-drone
  total. After the last group exits, a brief result (`PERFECT!` or the hit count)
  shows, then play advances to the next stage.

You still move, fire, flip, and (if charged) discharge during a challenge stage.

## Scoring

- **Shard:** `50` in formation, `100` while diving.
- **Flux:** `80` in formation, `160` while diving.
- **Prism:** `100` for the shell, `400` for the core kill.
- **Challenge drone:** `100` each, plus the `10000` perfect bonus.
- **Stage cleared:** a `1000`-point bonus for clearing a standard wave.
- A discharge (`specs/polarity.md`) scores each drone it destroys as a **diving**
  kill.

Score accumulates across the whole game (all stages of one run) and shows in the
HUD. Scores are **not persisted** between sessions.

## Lives and getting hit

- You start a game with **3 lives**.
- You lose a life when an **opposite-band** enemy bullet hits you, or any drone's
  **body** contacts you (`specs/polarity.md`). A **same-band** bullet is absorbed
  harmlessly and never costs a life.
- **On losing a life** (if lives remain): a brief **`READY` hold** plays, then the
  ship reappears at the center of its lane and play resumes. **The wave continues
  where it was** — the formation, the drones, and any active dive persist; they
  are not reset. Your **resonance meter is kept** (it is not reset by death;
  `specs/polarity.md`).
- An **extra life** is awarded once, at **`20000`** points.
- Losing your **last** life ends the game (Game over, below).

## Stage scaling

Deeper stages are more dangerous, scaling with the stage number `s` (with `s = 1`
the first stage). On every standard stage:

- **Drone speed** (entrance and dive, `specs/enemies.md`) is multiplied by
  `1 + 0.06 * (s - 1)`, capped at `1.50`.
- **Enemy bullet speed** is multiplied by `1 + 0.04 * (s - 1)`, capped at `1.40`.
- **Dive cadence** shortens: the gap between dives is scaled by
  `max(0.55, 1 - 0.05 * (s - 1))`, so the assault presses harder.
- **The Flux** flips faster: its hold time (`specs/enemies.md`) is
  `max(1.0, 1.6 - 0.05 * (s - 1))` seconds (the `0.4 s` shimmer is unchanged).
- The **formation grows** toward the slot capacity (`specs/playfield.md`), leaning
  more on Fluxes and Prisms.
- All other rules (the matching rules, the shield, brightness of bands, the
  resonance meter and discharge) are unchanged.

Challenge stages do not scale; they are the same flyover whenever they occur.

## Game states

The game is a small state machine. Each state has a clear screen and controls
(controls are defined in `specs/controls.md`).

1. **Title / main menu.** Shows the title `SPECTRA`, the tagline `TUNE TO
   SURVIVE`, and a vertical menu listing the playable modes defined by the mode
   specs (each mode spec declares its own entry), followed by `HOW TO PLAY`. The
   selected item is highlighted. A dim slice of starfield with a drone or two may
   show behind the menu for atmosphere.
2. **How to play.** Describes the controls, the two bands and the match-to-destroy
   and shield rules, the three drones, and the discharge. Returns to the menu.
3. **Stage intro.** A brief hold before a wave, showing `STAGE n` (or
   `CHALLENGING STAGE`) over the field before the drones begin to enter.
4. **In wave.** The live game: the formation, the drones entering, diving, and
   firing, your ship and its bullets, and the HUD. Includes the brief `READY`
   hold after losing a life.
5. **Paused.** Reachable from a wave. Offers **Resume**, **Restart**, and **Quit
   to menu**. The field is visible but frozen behind the pause menu.
6. **Stage cleared.** A brief interstitial when a stage is cleared
   (e.g. `STAGE 1 CLEARED`, with the stage bonus, or a challenge-stage result)
   before the next stage begins.
7. **Game over.** Shown when the last life is lost. Displays the final **score**
   and the **stage reached**, with **PLAY AGAIN** and **MENU**.

## HUD

The HUD layout (score and stage in the top strip; lives, the resonance meter, and
the polarity indicator in the bottom strip) is defined in `specs/playfield.md`.
The polarity indicator and the ship's core color always show the current band.

## Audio

Audio is recommended but optional, and must never be required for the game to run
or load. If included, synthesize it with the Web Audio API (no audio files):
distinct short cues for firing, flipping bands, absorbing a same-band bullet, a
matching kill, a discharge, a Prism's spectral inversion, getting hit, and
clearing a stage. Provide a mute toggle, and do not start audio until the player
interacts (browsers block autoplay).

## Key behaviors

The game must exhibit these behaviors. They are observable and make good test
targets:

- A **matching** shot destroys a drone; a **mismatched** shot is **wasted**
  (`specs/polarity.md`).
- Your band is your **shield**: a **same-band** enemy bullet is absorbed and feeds
  resonance, an **opposite-band** bullet costs a life, and a **drone body** always
  costs a life on contact.
- Flipping bands is **instant** but imposes a **`0.30 s` fire lockout**; the
  formation always mixes **both** bands, so clearing it forces constant flipping.
- The **resonance meter** fills from absorbed same-band bullets and matching
  kills; at full, a **discharge** wipes every entering/diving drone and all enemy
  bullets (band-blind) but spares the formation.
- Drones **fly in** on choreographed paths, assemble into a **swaying formation**,
  then **dive** and fire before returning — they are not present from the start.
- The **Shard** is a fixed band; the **Flux** oscillates on a telegraphed rhythm
  and **cannot be killed mid-shimmer**; the **Prism** is a two-band shell→core
  sequence, enters escorted, fires a two-band burst, and triggers a **spectral
  inversion** if a dive reaches the bottom.
- Every **third stage** is a **challenge stage**: a non-firing, single-band
  flyover with a perfect bonus.
- A hit costs a life while the **wave persists**; clearing a wave **advances** a
  stage; deeper stages are **faster** and press harder as specified above.

## Out of scope

- Network or online multiplayer.
- Touch or gamepad input (keyboard only for this version).
- Capturable or turnable drones, a captured-ship rescue, or a second/escort ship
  power-up.
- Persistence of scores or settings between sessions.
