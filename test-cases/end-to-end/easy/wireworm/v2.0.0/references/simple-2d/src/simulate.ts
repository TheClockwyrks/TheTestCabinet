// Wireworm — one frame, from the top.
//
// `stepFrame` is the whole of what an update does, and its order is the order
// the rules read in: the world moves, then the bolts resolve against where it
// now is, then the gun fires, then the level's own spawners run, then the two
// transitions a frame can raise are tested. Nothing here reads the renderer or
// the wall clock, so an interval of game time reaches the same state however it
// was divided into frames.
//
// The two transitions are the ones `specs/progression.md` fixes. A level clears
// on the step in which the last of its segments is removed, so the test is what
// the frame REMOVED and not what the board holds; a contact costs a life, and
// the cursor's own gate is what a scenario turns off when its requirement is
// something else.

import { CUES } from "./constants";
import { advanceBolts, fireBolts } from "./bolts";
import { cursorTouched, moveCursor } from "./cursor";
import { ageArcs } from "./discharge";
import { advanceFoes, runSpawners } from "./foes";
import {
  beginActive,
  clearLevel,
  goTo,
  loseLife,
  menuItems,
  startRun,
} from "./flow";
import { stepWorms } from "./worm";
import type { FrameInput } from "./input";
import type { FrameEvents, Sim } from "./sim";

/** Take the highlighted item of whatever menu the current screen shows. */
function confirmMenuItem(sim: Sim): void {
  switch (sim.screen) {
    case "title":
      if (sim.menuIndex === 0) startRun(sim);
      else goTo(sim, "howto");
      return;
    case "paused":
      if (sim.menuIndex === 0) resume(sim);
      else if (sim.menuIndex === 1) startRun(sim);
      else goTo(sim, "title");
      return;
    case "victory":
    case "gameover":
      if (sim.menuIndex === 0) startRun(sim);
      else goTo(sim, "title");
      return;
    default:
      return;
  }
}

/** Leave the pause screen with the board and the run exactly as they were. */
function resume(sim: Sim): void {
  sim.screen = "playing";
  sim.menuIndex = 0;
}

/** What `back` does on each screen that answers to it. */
function leaveScreen(sim: Sim): void {
  switch (sim.screen) {
    case "howto":
    case "victory":
    case "gameover":
      goTo(sim, "title");
      return;
    case "paused":
      resume(sim);
      return;
    default:
      return;
  }
}

/** A screen showing a menu, or the how-to page, which answers to `back` alone. */
function stepMenuScreen(sim: Sim, input: FrameInput, ev: FrameEvents): void {
  const items = menuItems(sim.screen);
  if (items !== null && items.length > 0) {
    if (input.menuUp) {
      sim.menuIndex = (sim.menuIndex - 1 + items.length) % items.length;
      ev.cues.add(CUES.menu);
    }
    if (input.menuDown) {
      sim.menuIndex = (sim.menuIndex + 1) % items.length;
      ev.cues.add(CUES.menu);
    }
    if (input.confirm) {
      confirmMenuItem(sim);
      return;
    }
  }
  if (input.back) leaveScreen(sim);
}

/** One frame of live play, in whichever of the three phases it is in. */
function stepPlaying(
  sim: Sim,
  input: FrameInput,
  dt: number,
  ev: FrameEvents,
): void {
  if (input.pause) {
    goTo(sim, "paused");
    return;
  }

  if (sim.phase !== "active") {
    sim.phaseTimer = Math.max(0, sim.phaseTimer - dt);
    if (sim.phaseTimer <= 0) beginActive(sim);
    return;
  }

  moveCursor(sim, input.mx, input.my, dt);
  sim.cursor.invulnerable = Math.max(0, sim.cursor.invulnerable - dt);

  stepWorms(sim, dt, ev);
  advanceFoes(sim, dt, ev);
  advanceBolts(sim, dt, ev);
  fireBolts(sim, input.fire, dt, ev);
  if (sim.foeSpawning) runSpawners(sim, dt);
  ageArcs(sim, dt);

  // The clear is the removal, so a board that never held a segment never clears.
  if (ev.segmentsRemoved > 0 && sim.worms.length === 0) {
    clearLevel(sim, ev);
    return;
  }

  if (
    sim.cursor.contact &&
    sim.cursor.invulnerable <= 0 &&
    cursorTouched(sim)
  ) {
    loseLife(sim, ev);
  }
}

/** Advance the whole game by `dt` seconds. */
export function stepFrame(
  sim: Sim,
  input: FrameInput,
  dt: number,
  ev: FrameEvents,
): void {
  // Simulation time accumulates whatever the screen, so a run left alone gives
  // way from its banner to live play on the game's own clock.
  sim.simTime += dt;

  if (sim.screen === "playing") {
    stepPlaying(sim, input, dt, ev);
    return;
  }
  stepMenuScreen(sim, input, ev);
}
