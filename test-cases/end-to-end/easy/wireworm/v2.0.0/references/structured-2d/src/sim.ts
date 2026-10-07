// Wireworm — the simulation one frame owes the game.
//
// The game mode's tick calls this once a frame with the delta the engine
// measured, and everything the game does on its own happens here. What the
// PLAYER does happens one step earlier, in the player controller, which resolves
// the frame's input into the state before any of this runs (`specs/state.md`,
// The contract).
//
// The order below is the order the specification's rules compose in:
//
//   1. Simulation time accumulates on every screen, whatever it is.
//   2. Only the `playing` screen advances. `paused` is frozen — no worm steps,
//      no foe moves, no bolt travels, no phase timer runs and no cue plays — so
//      a paused game is exactly where it was when it was paused (`specs/ui.md`).
//   3. The `banner` and `respawn` phases run their timer alone. Live play is the
//      `active` phase.
//   4. In `active`: the worms step on their own clocks, the foes travel and act,
//      the bolts fly and resolve, and the arcs of a live discharge age out.
//   5. The level clears on the step in which the last of its segments is
//      removed, so the clear is checked against the removals THIS update made
//      rather than against an empty board.
//   6. The level's own spawners run, and then the cursor's contact test.

import type { FrameCues } from "./audio";
import { advanceBolts } from "./bolts";
import { cursorTouched } from "./cursor";
import { advanceArcs } from "./discharge";
import { advanceFoes, runSpawners } from "./foes";
import { clearLevel, enterActive, loseLife } from "./flow";
import type { WirewormState } from "./game";
import { advanceWorms } from "./worm";

/** Advance the whole game by `dt` seconds, collecting the cues it raised. */
export function advanceGame(
  state: WirewormState,
  dt: number,
  cues: FrameCues,
): void {
  // Accumulated on every screen, which is what makes it the game's own clock
  // rather than the play clock (`specs/instrumentation.md`).
  state.simTime += dt;

  if (state.screen !== "playing") return;

  if (state.phase !== "active") {
    advancePhaseTimer(state, dt);
    return;
  }

  state.cursor.invulnerable = Math.max(0, state.cursor.invulnerable - dt);
  state.fireCooldown = Math.max(0, state.fireCooldown - dt);

  advanceWorms(state, dt, cues);
  advanceFoes(state, dt, cues);
  const cut = advanceBolts(state, dt, cues);
  advanceArcs(state, dt);

  if (cut > 0 && state.worms.length === 0) {
    clearLevel(state, cues);
    return;
  }

  if (state.foeSpawning) runSpawners(state, dt);

  if (state.cursor.contact && state.cursor.invulnerable <= 0) {
    if (cursorTouched(state)) loseLife(state, cues);
  }
}

/**
 * The `banner` and `respawn` phases: a timer counting down against the frame's
 * delta, and the transition to live play it runs out into. The level's worm
 * enters at that moment and at no other (`specs/progression.md`), and a respawn
 * hands the cursor its `RESPAWN_INVULN` seconds of invulnerability as it does.
 */
function advancePhaseTimer(state: WirewormState, dt: number): void {
  state.phaseTimer -= dt;
  if (state.phaseTimer > 0) return;
  enterActive(state, state.phase === "respawn");
}
