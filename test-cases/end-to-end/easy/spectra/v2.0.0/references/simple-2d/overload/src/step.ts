// Spectra — one frame, from the top (`specs/simulation.md`).
//
// An update covering `dt` seconds is divided into `n = max(1, ceil(dt /
// SUBSTEP_MAX))` sub-steps of `h = dt / n` seconds each, and the sub-steps run in
// order. Each one advances every moving thing by `v * h` and then resolves
// contacts, so one second of game time covers the same ground whether it arrives as
// one frame, as sixty or as a hundred and twenty: each runs a hundred and twenty
// sub-steps of a hundred-and-twentieth of a second.
//
// The whole game runs inside that loop, screens included, so a hold that expires
// part-way through a frame gives the sub-steps after it to whatever it opened.
// `simTime` takes each sub-step's own `h`, on every screen.
//
// A press is news for exactly one sub-step: the edges are delivered to the first
// and withheld from the rest, while a held direction or a held fire button applies
// to every one of them.

import {
  CUES,
  FIRE_INTERVAL,
  FLIP_LOCKOUT,
  MAX_PLAYER_BULLETS,
  PLAYER_BULLET_H,
  SHIP_H,
  SHIP_SPEED,
  SHIP_X_MAX,
  SHIP_X_MIN,
  SUBSTEP_MAX,
  SHIP_Y,
  TITLE_ITEMS,
} from "./constants";
import { opposite, shipAlive } from "./bands";
import { addPlayerBullet, advanceBullets } from "./bullets";
import { advanceBursts } from "./bursts";
import { resolveContacts } from "./contacts";
import { advanceDischarge, releaseDischarge } from "./discharge";
import { advanceDrones, advanceEntry, launchDives, ofWave } from "./drones";
import {
  advanceStage,
  beginWave,
  clearStage,
  endReadyHold,
  goTo,
  startRun,
} from "./flow";
import { heldOnly, type FrameInput } from "./input";
import { highlightedItem, itemAt, menuOf } from "./menus";
import type { PointerSample } from "@test-cabinet/simple-2d";

import type { Screen } from "./game";
import type { FrameEvents, Sim } from "./sim";

/** `HOW TO PLAY`'s index on the title menu (`specs/ui.md`, `TITLE_ITEMS`). */
const HOW_TO_PLAY_INDEX = TITLE_ITEMS.indexOf("HOW TO PLAY");

/** Where a shot leaves the hull: on the ship's own centre x, above its nose. */
export const NOSE_Y = SHIP_Y - SHIP_H / 2 - PLAYER_BULLET_H / 2;

/** Move the ship along its lane, which it never leaves. */
function moveShip(sim: Sim, moveX: number, h: number): void {
  if (moveX === 0) return;
  sim.ship.x = Math.max(
    SHIP_X_MIN,
    Math.min(SHIP_X_MAX, sim.ship.x + moveX * SHIP_SPEED * h),
  );
}

/** Fire, where the cadence, the cap and the lockout all allow a shot. */
function fireCannon(sim: Sim, firing: boolean, ev: FrameEvents): void {
  if (!firing) return;
  if (sim.ship.cooldown > 0 || sim.ship.lockout > 0) return;
  const inFlight = sim.bullets.filter((bullet) => bullet.friendly).length;
  if (inFlight >= MAX_PLAYER_BULLETS) return;
  addPlayerBullet(sim, sim.ship.x, NOSE_Y, sim.ship.band);
  sim.ship.cooldown = FIRE_INTERVAL;
  ev.cues.add(CUES.fire);
}

/**
 * Take item `index` of whatever menu the current screen shows.
 *
 * `specs/ui.md` gives the keyboard, the pointer and a finger the same effect, so
 * every confirm lands here rather than each input carrying its own copy of what an
 * entry does.
 */
function confirmMenuItem(sim: Sim, index: number): void {
  switch (sim.screen) {
    case "title":
      if (index === 0) startRun(sim);
      else goTo(sim, "howto");
      return;
    case "paused":
      if (index === 0) resume(sim);
      else if (index === 1) startRun(sim);
      else goTo(sim, "title");
      return;
    case "gameOver":
      if (index === 0) startRun(sim);
      else goTo(sim, "title");
      return;
    default:
      return;
  }
}

/** Leave the pause screen with the field and the run exactly as they were. */
function resume(sim: Sim): void {
  sim.screen = "inWave";
  sim.menuIndex = 0;
}

/** Move the highlight of the current screen's menu, if it has one. */
function stepMenu(sim: Sim, input: FrameInput, ev: FrameEvents): void {
  const menu = menuOf(sim.screen);
  if (menu === null) return;
  const count = menu.items.length;
  if (input.menuUp) {
    sim.menuIndex = (highlightedItem(menu, sim.menuIndex) - 1 + count) % count;
    ev.cues.add(CUES.menu);
  }
  if (input.menuDown) {
    sim.menuIndex = (highlightedItem(menu, sim.menuIndex) + 1) % count;
    ev.cues.add(CUES.menu);
  }
  if (input.confirm) {
    confirmMenuItem(sim, highlightedItem(menu, sim.menuIndex));
  }
}

/** The title screen and the game-over screen, which read a menu and nothing else. */
function stepMenuScreen(sim: Sim, input: FrameInput, ev: FrameEvents): void {
  stepMenu(sim, input, ev);
}

/** The how-to-play screen, which answers to `back` alone. */
function stepHowTo(sim: Sim, input: FrameInput): void {
  // The title comes back on the entry that led here (`specs/ui.md`).
  if (input.back) {
    goTo(sim, "title");
    sim.menuIndex = HOW_TO_PLAY_INDEX;
  }
}

/** The paused screen: the field is frozen and only the menu answers. */
function stepPaused(sim: Sim, input: FrameInput, ev: FrameEvents): void {
  if (input.pause || input.back) {
    resume(sim);
    return;
  }
  stepMenu(sim, input, ev);
}

/** The stage-intro hold, which builds the stage's wave as it gives way. */
function stepStageIntro(sim: Sim, h: number): void {
  sim.phaseTimer = Math.max(0, sim.phaseTimer - h);
  if (sim.phaseTimer <= 0) beginWave(sim);
}

/** The stage-cleared interstitial, which opens the next stage's intro. */
function stepStageCleared(sim: Sim, h: number): void {
  sim.phaseTimer = Math.max(0, sim.phaseTimer - h);
  if (sim.phaseTimer <= 0) advanceStage(sim);
}

/** One sub-step of the live wave, in whichever of its two phases it is in. */
function stepWave(
  sim: Sim,
  input: FrameInput,
  h: number,
  ev: FrameEvents,
): void {
  if (input.pause) {
    goTo(sim, "paused");
    return;
  }

  sim.ship.lockout = Math.max(0, sim.ship.lockout - h);
  sim.ship.cooldown = Math.max(0, sim.ship.cooldown - h);
  sim.inversion = Math.max(0, sim.inversion - h);
  sim.swayClock += h;

  if (shipAlive(sim.phase)) {
    if (input.flip) {
      sim.ship.band = opposite(sim.ship.band);
      sim.ship.lockout = FLIP_LOCKOUT;
      ev.cues.add(CUES.flip);
    }
    if (input.discharge) releaseDischarge(sim, ev);
    moveShip(sim, input.moveX, h);
    fireCannon(sim, input.fire, ev);
  } else {
    sim.phaseTimer = Math.max(0, sim.phaseTimer - h);
    if (sim.phaseTimer <= 0) endReadyHold(sim);
  }

  advanceDrones(sim, h, ev);
  advanceBullets(sim, h);
  advanceDischarge(sim, h);
  advanceBursts(sim, h);
  advanceEntry(sim, h);
  launchDives(sim, h);
  resolveContacts(sim, ev);

  // The clear is the removal of the wave's own last drone, so a wave that never
  // held one never clears and a drone a scenario placed clears nothing.
  if (
    sim.screen === "inWave" &&
    ev.waveDronesRemoved > 0 &&
    !sim.drones.some(ofWave)
  ) {
    clearStage(sim, ev);
  }
}

/** Advance the whole game by one sub-step of `h` seconds. */
function stepSubstep(
  sim: Sim,
  input: FrameInput,
  h: number,
  ev: FrameEvents,
): void {
  // Simulation time accumulates whatever the screen, so a run left alone gives
  // way from its holds on the game's own clock.
  sim.simTime += h;

  switch (sim.screen) {
    case "inWave":
      stepWave(sim, input, h, ev);
      return;
    case "paused":
      stepPaused(sim, input, ev);
      return;
    case "stageIntro":
      stepStageIntro(sim, h);
      return;
    case "stageCleared":
      stepStageCleared(sim, h);
      return;
    case "howto":
      stepHowTo(sim, input);
      return;
    default:
      stepMenuScreen(sim, input, ev);
      return;
  }
}

/** Advance the whole game by `dt` seconds, in whole sub-steps. */
export function stepFrame(
  sim: Sim,
  input: FrameInput,
  dt: number,
  ev: FrameEvents,
): void {
  const opened = sim.screen;
  const steps = Math.max(1, Math.ceil(dt / SUBSTEP_MAX));
  const h = dt / steps;
  const held = heldOnly(input);
  for (let step = 0; step < steps; step++) {
    stepSubstep(sim, step === 0 ? input : held, h, ev);
  }
  // The pointer and the touch contacts are read once per frame and applied AFTER
  // the frame's keyboard edges (`specs/ui.md`).
  stepPointer(sim, input.pointer, opened, ev);
}

/* -------------------------------------------------------------------------- */
/* The pointer and the finger                                                 */
/* -------------------------------------------------------------------------- */
//
// A press and the release that ends it may be frames apart, so where each press
// landed is remembered until it comes up. The anchor records the screen as well as
// the item, so a press that spans a change of screen — the keyboard's or the debug
// surface's — confirms nothing.

/** Where one press went down: the screen it landed on, and the item under it. */
interface PressAnchor {
  readonly screen: Screen;
  readonly index: number | null;
}

const anchors = new Map<number, PressAnchor>();

/** Forget every press in progress. Called as a fresh game is initialized. */
export function forgetPresses(): void {
  anchors.clear();
}

/** Move the selection to `index`, raising the menu cue if it actually moved. */
function selectItem(sim: Sim, index: number, ev: FrameEvents): void {
  if (sim.menuIndex === index) return;
  sim.menuIndex = index;
  ev.cues.add(CUES.menu);
}

/**
 * Apply this frame's pointer samples to the menu on screen.
 *
 * A move onto an item selects it, and so does a landing — which is what makes a
 * finger, which never hovers, select the item it lands on. A confirm takes BOTH its
 * edges inside one item's region: a press and a release in different regions, or
 * either of them outside every region, confirms nothing.
 */
function stepPointer(
  sim: Sim,
  samples: readonly PointerSample[],
  opened: Screen,
  ev: FrameEvents,
): void {
  // A frame whose keys left the screen has already had its confirm, and the menu
  // the pointer was over is gone; the presses in progress go with it.
  if (sim.screen !== opened) {
    anchors.clear();
    return;
  }
  for (const sample of samples) {
    const menu = menuOf(sim.screen);
    const index = menu === null ? null : itemAt(menu, sample.x, sample.y);
    if (sample.type === "down") {
      anchors.set(sample.id, { screen: sim.screen, index });
      // A finger does not hover, so a landing is what selects under touch.
      if (sample.device === "touch" && index !== null) {
        selectItem(sim, index, ev);
      }
      continue;
    }
    if (sample.type === "move") {
      if (index !== null) selectItem(sim, index, ev);
      continue;
    }
    const anchor = anchors.get(sample.id);
    anchors.delete(sample.id);
    if (
      anchor === undefined ||
      index === null ||
      anchor.index !== index ||
      anchor.screen !== sim.screen
    ) {
      continue;
    }
    selectItem(sim, index, ev);
    confirmMenuItem(sim, index);
  }
}
