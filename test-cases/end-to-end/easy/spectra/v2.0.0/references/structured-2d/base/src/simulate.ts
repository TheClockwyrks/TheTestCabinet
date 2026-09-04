// Spectra — how a frame advances the game (`specs/simulation.md`).
//
// THERE IS NO FIXED TIMESTEP. Every rate is per second and is integrated against
// the elapsed time of the frame, and a frame covering `dt` seconds is divided
// into `n = max(1, ceil(dt / SUBSTEP_MAX))` sub-steps of `h = dt / n` seconds
// each. One second of game time therefore covers the same ground whether it
// arrives as one frame, as sixty or as a hundred and twenty: each runs a hundred
// and twenty sub-steps of a hundred-and-twentieth of a second. Every clock, every
// countdown and every position in this build moves inside that loop, which is
// what makes the identity exact rather than approximate.
//
// A PRESS IS ONE PRESS. The held actions — a direction, the fire button — are
// read by every sub-step, because a hold is a hold for the whole frame. The edge
// actions are handed to the first sub-step alone, so a flip, a discharge, a menu
// move, a pause or a confirm acts exactly once however finely the frame was
// divided.
//
// ONE SUB-STEP RESOLVES IN A FIXED ORDER, after every position has advanced:
// the player's bullets against the drones nearest-first, the enemy bullets
// against the ship, the drone bodies against the ship, the live discharge wave
// against what it has reached, and then the removals and the bursts they start.
// Nothing is destroyed halfway through that order: a contact marks its subject,
// and the marks are spent at the end.

import {
  CHALLENGE_TOTAL,
  ENEMY_BULLET_HALF,
  FIELD_BOTTOM,
  FIELD_TOP,
  FLUX_HALF,
  FLUX_SIZE,
  PLAYER_BULLET_HALF,
  PRISM_CORE_HALF,
  PRISM_CORE_SIZE,
  PRISM_HALF,
  PRISM_SIZE,
  RESONANCE_ABSORB,
  RESONANCE_KILL,
  SHARD_HALF,
  SHARD_SIZE,
  SHIP_HALF,
  SHIP_SPEED,
  SHIP_Y,
  SUBSTEP_MAX,
  TITLE_ITEMS,
  isChallengeStage,
} from "./constants";
import { bulletBand, droneBand, inverted, isShimmering } from "./bands";
import { clampLane, canFire, fire, flip } from "./ship";
import {
  clearStage,
  endReadyHold,
  loseLife,
  menuLength,
  openNextStage,
  openWave,
  startRun,
} from "./flow";
import { droneScore, shellScore, award } from "./scoring";
import {
  fillResonance,
  releaseDischarge,
  stepDischarge,
  waveReaches,
} from "./discharge";
import { startBurst, stepBursts } from "./bursts";
import { highlightedItem, itemAt, menuOf } from "./menus";
import { stepDiveLaunching, stepSwarm } from "./swarm";
import type { PointerSample } from "@test-cabinet/structured-2d";

import type { FrameInput } from "./input";
import type { FrameEvents } from "./events";
import type { DroneState, Screen, SpectraState } from "./game";

/** The half-extent a contact with this drone is decided by. */
export function droneHalf(
  drone: Pick<DroneState, "kind" | "shellAlive">,
): number {
  switch (drone.kind) {
    case "shard":
      return SHARD_HALF;
    case "flux":
      return FLUX_HALF;
    case "prism":
      return drone.shellAlive ? PRISM_HALF : PRISM_CORE_HALF;
  }
}

/** The footprint this drone is drawn at, which is the size its burst plays at. */
export function droneSize(
  drone: Pick<DroneState, "kind" | "shellAlive">,
): number {
  switch (drone.kind) {
    case "shard":
      return SHARD_SIZE;
    case "flux":
      return FLUX_SIZE;
    case "prism":
      return drone.shellAlive ? PRISM_SIZE : PRISM_CORE_SIZE;
  }
}

/** Whether two circles about their centres overlap. */
function touches(
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number,
): boolean {
  return Math.hypot(ax - bx, ay - by) <= ar + br;
}

/** What one sub-step has marked for removal, and the pops it owes. */
interface Marks {
  readonly drones: Set<number>;
  readonly bullets: Set<number>;
  readonly pops: { x: number; y: number; size: number }[];
}

/** `HOW TO PLAY`'s index on the title menu (`specs/ui.md`, `TITLE_ITEMS`). */
const HOW_TO_PLAY_INDEX = TITLE_ITEMS.indexOf("HOW TO PLAY");

/** Advance the frame: every clock, every path and every contact in `dt`. */
export function stepFrame(
  state: SpectraState,
  input: FrameInput,
  dt: number,
  events: FrameEvents,
): void {
  const steps = Math.max(1, Math.ceil(dt / SUBSTEP_MAX));
  const h = dt / steps;
  // The edges belong to the frame, not to each of its sub-steps.
  const holdsOnly: FrameInput = {
    ...input,
    flip: false,
    discharge: false,
    menuUp: false,
    menuDown: false,
    confirm: false,
    back: false,
    pause: false,
    mute: false,
  };
  const opened = state.screen;
  for (let i = 0; i < steps; i++) {
    stepSub(state, i === 0 ? input : holdsOnly, h, events);
  }
  // The pointer and the touch contacts are read once per frame and applied AFTER
  // the frame's keyboard edges (`specs/ui.md`).
  stepPointer(state, input.pointer, opened, events);
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
function selectItem(
  state: SpectraState,
  index: number,
  events: FrameEvents,
): void {
  if (state.menuIndex === index) return;
  state.menuIndex = index;
  events.cues.add("menu");
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
  state: SpectraState,
  samples: readonly PointerSample[],
  opened: Screen,
  events: FrameEvents,
): void {
  // A frame whose keys left the screen has already had its confirm, and the menu
  // the pointer was over is gone; the presses in progress go with it.
  if (state.screen !== opened) {
    anchors.clear();
    return;
  }
  for (const sample of samples) {
    const menu = menuOf(state.screen);
    const index = menu === null ? null : itemAt(menu, sample.x, sample.y);
    if (sample.type === "down") {
      anchors.set(sample.id, { screen: state.screen, index });
      // A finger does not hover, so a landing is what selects under touch.
      if (sample.device === "touch" && index !== null) {
        selectItem(state, index, events);
      }
      continue;
    }
    if (sample.type === "move") {
      if (index !== null) selectItem(state, index, events);
      continue;
    }
    const anchor = anchors.get(sample.id);
    anchors.delete(sample.id);
    if (
      anchor === undefined ||
      index === null ||
      anchor.index !== index ||
      anchor.screen !== state.screen
    ) {
      continue;
    }
    selectItem(state, index, events);
    confirmItem(state, index);
  }
}

/**
 * Take item `index` of whichever menu the current screen shows.
 *
 * `specs/ui.md` gives the keyboard, the pointer and a finger the same effect, so
 * every confirm lands here rather than each input carrying its own copy of what an
 * entry does.
 */
function confirmItem(state: SpectraState, index: number): void {
  switch (state.screen) {
    case "title":
      if (index === 0) startRun(state);
      else state.screen = "howto";
      return;
    case "paused":
      if (index === 1) startRun(state);
      else if (index === 2) toTitle(state);
      else {
        state.screen = "inWave";
        state.menuIndex = 0;
      }
      return;
    case "gameOver":
      if (index === 0) startRun(state);
      else toTitle(state);
      return;
    default:
      return;
  }
}

/**
 * Return to the title, with its highlight on the entry that led away from it.
 *
 * `specs/ui.md`: the mode entry after a run, `HOW TO PLAY` after the how-to-play
 * screen.
 */
function toTitle(state: SpectraState, index = 0): void {
  state.screen = "title";
  state.menuIndex = index;
}

/** One sub-step: whichever screen is showing, advanced by `h` seconds. */
function stepSub(
  state: SpectraState,
  input: FrameInput,
  h: number,
  events: FrameEvents,
): void {
  // The accumulated simulation time covers every sub-step the game ran, on every
  // screen, so a second of game time adds exactly a second to it.
  state.simTime += h;

  switch (state.screen) {
    case "title":
      stepTitle(state, input, events);
      stepBursts(state, h);
      break;
    case "howto":
      // The title comes back on the entry that led here (`specs/ui.md`).
      if (input.back) toTitle(state, HOW_TO_PLAY_INDEX);
      stepBursts(state, h);
      break;
    case "stageIntro":
      state.phaseTimer = Math.max(0, state.phaseTimer - h);
      if (state.phaseTimer <= 0) openWave(state);
      stepBursts(state, h);
      break;
    case "inWave":
      stepWave(state, input, h, events);
      break;
    case "paused":
      // The field is frozen: no drone moves, no bullet travels, no phase timer
      // runs, none of the wave's clocks advances, and no cue plays.
      stepPaused(state, input, events);
      break;
    case "stageCleared":
      state.phaseTimer = Math.max(0, state.phaseTimer - h);
      stepBursts(state, h);
      if (state.phaseTimer <= 0) openNextStage(state);
      break;
    case "gameOver":
      stepGameOver(state, input, events);
      stepBursts(state, h);
      break;
  }
}

/** Move the highlight by one item, wrapping at both ends. */
function moveHighlight(
  state: SpectraState,
  delta: number,
  events: FrameEvents,
): void {
  const items = menuLength(state.screen);
  if (items <= 0) return;
  state.menuIndex = (state.menuIndex + delta + items) % items;
  events.cues.add("menu");
}

/** The title's menu: the mode entry, then how to play. */
function stepTitle(
  state: SpectraState,
  input: FrameInput,
  events: FrameEvents,
): void {
  if (input.menuUp) moveHighlight(state, -1, events);
  if (input.menuDown) moveHighlight(state, 1, events);
  if (!input.confirm) return;
  confirmHighlighted(state);
}

/** Take whichever item the menu on screen is DRAWING as highlighted. */
function confirmHighlighted(state: SpectraState): void {
  const menu = menuOf(state.screen);
  if (menu === null) return;
  confirmItem(state, highlightedItem(menu, state.menuIndex));
}

/** The pause menu, over the frozen field. */
function stepPaused(
  state: SpectraState,
  input: FrameInput,
  events: FrameEvents,
): void {
  if (input.menuUp) moveHighlight(state, -1, events);
  if (input.menuDown) moveHighlight(state, 1, events);
  // Both `pause` and `back` return to the live wave, exactly as it was.
  if (input.pause || input.back) {
    state.screen = "inWave";
    state.menuIndex = 0;
    return;
  }
  if (!input.confirm) return;
  confirmHighlighted(state);
}

/** The game-over menu: play again, or the title. */
function stepGameOver(
  state: SpectraState,
  input: FrameInput,
  events: FrameEvents,
): void {
  if (input.menuUp) moveHighlight(state, -1, events);
  if (input.menuDown) moveHighlight(state, 1, events);
  if (!input.confirm) return;
  confirmHighlighted(state);
}

/** One sub-step of the live wave. */
function stepWave(
  state: SpectraState,
  input: FrameInput,
  h: number,
  events: FrameEvents,
): void {
  if (input.pause) {
    state.screen = "paused";
    state.menuIndex = 0;
    return;
  }

  const alive = state.phase === "live";

  // ---- the ship and its cannon ------------------------------------------
  state.ship.lockout = Math.max(0, state.ship.lockout - h);
  state.ship.cooldown = Math.max(0, state.ship.cooldown - h);
  if (alive) {
    if (input.mx !== 0)
      state.ship.x = clampLane(state.ship.x + input.mx * SHIP_SPEED * h);
    if (input.flip) flip(state, events);
    if (input.fire && canFire(state)) fire(state, events);
    if (input.discharge && releaseDischarge(state))
      events.cues.add("discharge");
  }

  // ---- the wave's own clocks --------------------------------------------
  state.swayClock += h;
  if (state.waveEntry) state.entryClock += h;
  stepDiveLaunching(state, h);

  // ---- everything moves -------------------------------------------------
  stepSwarm(state, h, events);
  stepBullets(state, h);
  stepDischarge(state, h);
  state.inversion = Math.max(0, state.inversion - h);

  // ---- and then the contacts resolve, in order --------------------------
  const marks: Marks = { drones: new Set(), bullets: new Set(), pops: [] };
  resolvePlayerBullets(state, marks, events);
  if (alive) resolveShipContacts(state, marks, events);
  resolveDischarge(state, marks, events);
  spendMarks(state, marks, events);

  stepBursts(state, h);

  // ---- the beats a wave keeps ------------------------------------------
  if (state.phase === "ready") {
    state.phaseTimer = Math.max(0, state.phaseTimer - h);
    if (state.phaseTimer <= 0) endReadyHold(state);
  }

  // A stage clears in the MOMENT the last drone of its wave leaves the field, so
  // a live wave that holds no drone and has had none removed is being played.
  if (
    state.screen === "inWave" &&
    state.drones.length === 0 &&
    events.dronesRemoved > 0
  ) {
    clearStage(state, events);
  }
}

/** Every bullet travels, and one that leaves the play field is removed. */
function stepBullets(state: SpectraState, h: number): void {
  for (const bullet of state.bullets) {
    bullet.x += bullet.vx * h;
    bullet.y += bullet.vy * h;
  }
  state.bullets = state.bullets.filter((bullet) =>
    bullet.friendly ? bullet.y >= FIELD_TOP : bullet.y <= FIELD_BOTTOM,
  );
}

/** Destroy `drone`: score it, pop it, and mark it gone. */
function killDrone(
  state: SpectraState,
  drone: DroneState,
  marks: Marks,
  byMatchingShot: boolean,
  events: FrameEvents,
): void {
  marks.drones.add(drone.id);
  marks.pops.push({ x: drone.x, y: drone.y, size: droneSize(drone) });
  award(state, droneScore(drone.kind, drone.phase, state.stage));
  if (isChallengeStage(state.stage)) {
    state.challengeHits = Math.min(CHALLENGE_TOTAL, state.challengeHits + 1);
  }
  if (byMatchingShot) fillResonance(state, RESONANCE_KILL);
  events.cues.add("kill");
}

/**
 * Each of the player's bullets against every drone, nearest drone first.
 *
 * A contact consumes the bullet whatever it does to the drone, and the two
 * EFFECTIVE bands decide the outcome and nothing else does. A shimmering Flux is
 * destroyed by no shot of either band, and a Prism's exposed layer falls to the
 * band that layer reads as — which the effective-band rule already carries, so
 * the comparison here is the one comparison for every kind.
 */
function resolvePlayerBullets(
  state: SpectraState,
  marks: Marks,
  events: FrameEvents,
): void {
  const swapped = inverted(state.inversion);
  for (const bullet of state.bullets) {
    if (!bullet.friendly || marks.bullets.has(bullet.id)) continue;
    const reach = state.drones
      .filter(
        (drone) =>
          !marks.drones.has(drone.id) &&
          touches(
            bullet.x,
            bullet.y,
            PLAYER_BULLET_HALF,
            drone.x,
            drone.y,
            droneHalf(drone),
          ),
      )
      .sort(
        (a, b) =>
          Math.hypot(a.x - bullet.x, a.y - bullet.y) -
          Math.hypot(b.x - bullet.x, b.y - bullet.y),
      );
    const drone = reach[0];
    if (drone === undefined) continue;
    marks.bullets.add(bullet.id);

    if (isShimmering(drone, state.stage)) continue;
    if (bulletBand(bullet, swapped) !== droneBand(drone, state.stage, swapped))
      continue;

    if (drone.kind === "prism" && drone.shellAlive) {
      // The shell falls and the core is exposed: the Prism is alive, its pop is
      // the shell's, and the meter takes nothing for a shell.
      marks.pops.push({ x: drone.x, y: drone.y, size: droneSize(drone) });
      drone.shellAlive = false;
      award(state, shellScore(state.stage));
      events.cues.add("kill");
      continue;
    }
    killDrone(state, drone, marks, true, events);
  }
}

/**
 * The enemy bullets against the ship, and then the drone bodies against it.
 *
 * A bullet of the ship's own band is absorbed and fills the meter; one of the
 * opposite band costs a life. A drone's body is not filtered by the shield at
 * all — contact with any drone of either band hits the ship — except in a
 * challenge stage, where a drone's body costs nothing.
 */
function resolveShipContacts(
  state: SpectraState,
  marks: Marks,
  events: FrameEvents,
): void {
  if (!state.ship.contact) return;
  const swapped = inverted(state.inversion);

  for (const bullet of state.bullets) {
    if (bullet.friendly || marks.bullets.has(bullet.id)) continue;
    if (
      !touches(
        bullet.x,
        bullet.y,
        ENEMY_BULLET_HALF,
        state.ship.x,
        SHIP_Y,
        SHIP_HALF,
      )
    ) {
      continue;
    }
    marks.bullets.add(bullet.id);
    if (bulletBand(bullet, swapped) === state.ship.band) {
      fillResonance(state, RESONANCE_ABSORB);
      events.cues.add("absorb");
      continue;
    }
    loseLife(state, events);
    return;
  }

  if (isChallengeStage(state.stage)) return;
  for (const drone of state.drones) {
    if (marks.drones.has(drone.id)) continue;
    if (
      !touches(
        drone.x,
        drone.y,
        droneHalf(drone),
        state.ship.x,
        SHIP_Y,
        SHIP_HALF,
      )
    ) {
      continue;
    }
    loseLife(state, events);
    return;
  }
}

/**
 * The live discharge wave against what it has reached.
 *
 * It is band-blind, it destroys every drone entering, diving or returning — a
 * Prism whole, shell and core together, in one step — it clears every enemy
 * bullet, and it spares the formation and the player's own bullets.
 */
function resolveDischarge(
  state: SpectraState,
  marks: Marks,
  events: FrameEvents,
): void {
  if (!state.discharge.active) return;

  for (const drone of state.drones) {
    if (marks.drones.has(drone.id)) continue;
    if (drone.phase === "formation") continue;
    if (!waveReaches(state, drone.x, drone.y)) continue;
    if (drone.kind === "prism" && drone.shellAlive) {
      // Whole, in one step: the shell and the core pay together, and the pop is
      // the one pop `specs/assets.md` gives a destroyed drone.
      award(state, shellScore(state.stage));
    }
    killDrone(state, drone, marks, false, events);
  }

  for (const bullet of state.bullets) {
    if (bullet.friendly || marks.bullets.has(bullet.id)) continue;
    if (waveReaches(state, bullet.x, bullet.y)) marks.bullets.add(bullet.id);
  }
}

/** Everything marked leaves its roster, and every destroyed drone pops. */
function spendMarks(
  state: SpectraState,
  marks: Marks,
  events: FrameEvents,
): void {
  if (marks.drones.size > 0) {
    state.drones = state.drones.filter((drone) => !marks.drones.has(drone.id));
    events.dronesRemoved += marks.drones.size;
  }
  if (marks.bullets.size > 0) {
    state.bullets = state.bullets.filter(
      (bullet) => !marks.bullets.has(bullet.id),
    );
  }
  for (const pop of marks.pops) startBurst(state, pop.x, pop.y, pop.size);
}
