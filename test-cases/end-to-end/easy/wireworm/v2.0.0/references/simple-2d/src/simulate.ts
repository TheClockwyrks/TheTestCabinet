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

import { CUES, TITLE_ITEMS } from "./constants";
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
import { itemAt, menuFor } from "./menus";
import { stepWorms } from "./worm";
import type { Screen } from "./game";
import type { FrameInput } from "./input";
import type { FrameEvents, Sim } from "./sim";
import type { PointerSample } from "@clockwyrks/simple-2d";

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
      // A return selects the entry it left from (specs/ui.md), which for the
      // how-to screen is `HOW TO PLAY` rather than the first item.
      goTo(sim, "title", TITLE_ITEMS.indexOf("HOW TO PLAY"));
      return;
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

/** The item one pointer sample landed in, or `null` for a miss. */
function sampleItem(sim: Sim, sample: PointerSample): number | null {
  const menu = menuFor(sim.screen);
  return menu === null ? null : itemAt(menu, sample.x, sample.y);
}

/**
 * This frame's pointer and touch, applied after the keyboard edges
 * (`specs/ui.md`).
 *
 * Every sample the input frame collected is replayed in arrival order, which is
 * what makes a sweep across several items select the last one it entered rather
 * than only the position it ended at. A press records where it landed and
 * selects, because a finger never hovers; a move selects the item it moves onto;
 * and a release confirms only when it falls inside the very item its own press
 * did.
 *
 * `spent` is a keyboard confirm already taken on this frame: the pass still runs
 * for its bookkeeping and confirms nothing, because a frame carrying both
 * confirms the keyboard's item alone.
 */
function stepPointer(
  sim: Sim,
  samples: readonly PointerSample[],
  spent: boolean,
): void {
  if (samples.length === 0) return;
  let taken = spent;

  for (const sample of samples) {
    const index = sampleItem(sim, sample);
    if (sample.type === "down") {
      sim.presses = [
        ...sim.presses.filter((press) => press.id !== sample.id),
        { id: sample.id, screen: sim.screen, index: index ?? -1 },
      ];
      if (!taken && index !== null) sim.menuIndex = index;
      continue;
    }
    if (sample.type === "move") {
      if (!taken && index !== null) sim.menuIndex = index;
      continue;
    }
    const anchor = sim.presses.find((press) => press.id === sample.id);
    sim.presses = sim.presses.filter((press) => press.id !== sample.id);
    if (
      !taken &&
      anchor !== undefined &&
      index !== null &&
      anchor.index === index &&
      anchor.screen === sim.screen
    ) {
      sim.menuIndex = index;
      confirmMenuItem(sim);
      taken = true;
    }
  }
}

/** A screen showing a menu, or the how-to page, which answers to `back` alone. */
function stepMenuScreen(sim: Sim, input: FrameInput, ev: FrameEvents): void {
  const opening = sim.screen;
  // `pause` and `back` both resume from the pause screen, and both are read
  // before the menu's own edges: a frame carrying either resumes and does
  // nothing else (specs/ui.md, specs/controls.md).
  if (sim.screen === "paused" && (input.pause || input.back)) {
    resume(sim);
    forgetPresses(sim, opening);
    return;
  }

  const items = menuItems(sim.screen);
  let spent = false;
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
      spent = true;
    }
  }
  if (!spent && input.back) {
    leaveScreen(sim);
    spent = true;
  }
  stepPointer(sim, input.pointer, spent);
  forgetPresses(sim, opening);
}

/**
 * Drop the presses in flight when the frame changed the screen.
 *
 * A confirm takes both of its edges on ONE menu (specs/ui.md), so a release
 * still to come belongs to a screen that is no longer shown.
 */
function forgetPresses(sim: Sim, opening: Screen): void {
  if (sim.screen !== opening) sim.presses = [];
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
    const opening = sim.screen;
    stepPlaying(sim, input, dt, ev);
    forgetPresses(sim, opening);
    return;
  }
  stepMenuScreen(sim, input, ev);
}
