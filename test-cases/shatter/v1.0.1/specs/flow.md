# Shatter — Scoring, lives, waves, the saucer, states, controls, and HUD

This file defines scoring, the ship's life-cycle, the wave loop, the enemy
saucer's behavior, the game's state machine, controls, audio, the HUD, and the
behaviors that make good test targets. It refers to the geometry in
`specs/playfield.md` and the physics in `specs/physics.md`.

## Scoring and lives

- **Score.** Destroying a rock by shooting it scores by size: **Large 20**,
  **Medium 50**, **Small 100** (smaller is worth more). Destroying the saucer
  scores **200**. A rock recycled by the star scores nothing. The score is shown
  in the HUD and only ever increases within a game.
- **Lives.** A game starts with **3** ships. Losing a ship costs one life; when
  the last ship is lost the game ends (see Game states → Game over).
- **Extra life.** The player earns one extra ship each time the score crosses a
  multiple of **10,000** points (at 10,000, 20,000, …). Show a brief indication
  when it is awarded.
- **Death.** A ship is destroyed when it collides with a rock, the saucer, or a
  saucer bullet (`specs/physics.md`) — unless it is in the respawn invulnerability
  window below. The star's core does **not** destroy the ship; the ship slides
  along it (`specs/physics.md`).
- **Respawn and invulnerability.** After a death, if any lives remain, the next
  ship appears at rest at the **safe point** `(640, 560)` facing up, and is
  **invulnerable for 2.5 seconds**, shown by a visible blink. During this window
  the ship is fully controllable but ignores **all** collisions, so a rock or the
  saucer drifting over the spawn point cannot kill it before the player takes
  control; collisions resume the instant the window ends. Use the grace period to
  fly clear.

## Waves

The game is an endless series of waves of rocks.

- **Wave spawn.** Wave `N` spawns `3 + N` **Large** rocks (so wave 1 has 4,
  wave 2 has 5, and so on). Spawn them at random positions **at least 300 px
  from the ship** and **at least 200 px from the star**, each drifting in a
  random direction at a Large rock's base drift speed (`specs/playfield.md`).
  Each successive wave scales the base drift speeds of newly spawned rocks up by
  **4%** per wave, capped at **+40%**, so later waves drift faster.
- **Clearing a wave.** A wave is cleared when **no rocks remain** on the field —
  which happens only by shooting every rock down to nothing, since the star
  recycles rather than removes (`specs/playfield.md`). On clearing, show a brief
  **`WAVE N`** banner (about 1.5 s, `N` being the wave about to start) centered
  on the field, then spawn the next wave. The ship keeps flying during the
  banner.

## The saucer

An enemy saucer periodically enters to hunt the ship (`specs/playfield.md` defines
its shape and size; `specs/physics.md` defines that it is never pulled by gravity).

- **Cadence.** At most **one** saucer exists at a time. The first appears about
  **18 seconds** into a game, and thereafter a new one appears every **25–35
  seconds** while the ship is alive and in play.
- **Movement.** The saucer enters at a random `y` from the left **or** right edge
  and crosses the field horizontally at about **140 px/s**, changing its vertical
  direction every second or so to weave, and wrapping top/bottom. It **steers to
  avoid the star's core**, never overlapping it. It despawns after it has crossed
  roughly `1.5` field widths or after about **12 seconds**, whichever comes first.
- **Firing.** Every about **1.6 seconds** the saucer fires one **saucer bullet**
  aimed at the ship's current position, with up to **±10 degrees** of random aim
  error. A saucer bullet leaves at **300 px/s** (plus the saucer's velocity), has
  a **1.4 s** lifetime, is pulled by gravity, wraps, is absorbed by the star core,
  and harms only the ship (`specs/physics.md`).
- **Reward.** Destroying the saucer with a bullet scores **200** and removes it.

## Game states

The game is a small state machine. Each state has a clear screen and controls.

1. **Title / main menu.** Shows the title `SHATTER`, the tagline `GRAVITY WELL
   SHOOTER`, and a vertical menu of `PLAY` then `HOW TO PLAY`. The selected
   item is highlighted. The field furniture — the star with its halo, a few
   dimmed drifting rocks, and the ship — may show dimmed behind the menu.
2. **How to play.** A simple screen describing the controls and the gravity,
   shooting, splitting, and wave mechanics. Returns to the menu.
3. **In game.** The live game: the ship, the star, the rocks, any bullets, the
   saucer, and the HUD (score and remaining lives).
4. **Paused.** Reachable from the game. Offers **Resume**, **Restart**, and **Quit
   to menu**. The field is visible but frozen behind the pause menu.
5. **Game over.** Shown when the last life is lost. Displays `GAME OVER`, the final
   score, and the wave reached, with **PLAY AGAIN** and **MENU**.

## Controls

Keyboard only.

- **Menus / pause / game-over:** `Up`/`Down` (or `W`/`S`) move the selection,
  `Enter` or `Space` confirms, `Esc` goes back.
- **Flying:** rotate with `Left`/`Right` **or** `A`/`D`; thrust with `Up` **or**
  `W`; fire with `Space`.
- **In game:** `Esc` or `P` pauses.

## Audio

Audio is recommended but optional, and must never be required for the game to run
or load. If included, synthesize it with the Web Audio API (no audio files):
distinct short sounds for firing, a rock shattering, the ship's thrust, the
saucer's presence, and the ship being destroyed. Provide a mute toggle, and do not
start audio until the player interacts (browsers block autoplay).

## HUD

- The **score** sits at the top-left in large monospace digits (about 44 px tall),
  its left edge near `x = 40` and its top near `y = 28`.
- **Remaining lives** are shown just below the score as a row of small ship
  glyphs (one per life still in reserve), starting near `(44, 92)`.
- A `WAVE N` banner appears centered on the field at the start of each wave (see
  Waves) and is not part of the persistent HUD.

## Key behaviors

The game must exhibit these behaviors. They make good targets for review:

- Thrust accelerates the ship along its facing and it **coasts** afterward under
  momentum; turning does not change velocity, only facing.
- The ship, bullets, and rocks all **wrap** at every edge; the saucer wraps too.
- The star **curves** bullets and rocks toward the center: a bullet fired past the
  star visibly bends, and rocks travel on curved rather than straight paths. The
  ship and the saucer are powered craft and are never pulled.
- Flying the ship into the star core does **not** destroy it — the core is solid
  and the ship slides along it — while a bullet that reaches the core is absorbed
  and a rock is recycled.
- A rock pulled into the star is destroyed and a **same-size** rock re-enters from
  off-screen, so the number of rocks on the field is conserved.
- Shooting a Large rock yields two Medium, a Medium yields two Small, and a Small
  is destroyed outright; fragments fan apart based on the shot direction.
- Bullets have a limited lifetime and an on-screen cap, and fire is rate-limited.
- Clearing every rock advances to a denser, faster wave, endlessly, with a brief
  wave banner.
- The saucer appears on a cadence, weaves across the field, fires aimed shots at
  the ship, wraps, avoids the star, and can be destroyed for points.
- Smaller rocks and the saucer are worth more points; the score only rises.
- Losing a ship respawns it at the safe point with invulnerability (or ends the
  game at zero lives); an extra ship is granted at each 10,000-point threshold.

## Out of scope

- Network or online multiplayer, and any second local player (single ship only).
- Touch or gamepad input (keyboard only for this version).
- A hyperspace/teleport escape move.
- Persistence of scores or settings between sessions (no high-score table).
- Rock-to-rock collisions (rocks pass through each other, `specs/physics.md`).
