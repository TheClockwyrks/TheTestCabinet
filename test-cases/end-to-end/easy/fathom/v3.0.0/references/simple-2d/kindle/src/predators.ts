// Fathom — the three predators (`specs/predators.md` and the files under
// `specs/predators/`).
//
// Each hunts a different signal the forager gives off: the Lanternjaw tracks
// light, the Gloamfin tracks sound, the Flarefish hunts in the flash of its own
// flare. This module owns the den's release schedule, each kind's sense, the
// fixes and the alert, the tells, and how a predator steers; the tile-locked
// travel it steers with is in `src/entities.ts`.
//
// A step is a pure function: it takes a predator and the world it stands in and
// returns the next predator beside whatever it raised — pings cast, cues to play,
// and the bloom lighting the maze. The game folds those into the next state.

import {
  ALERT_TIME,
  CUES,
  DEN_ORDER,
  DEN_RELEASE_GAP,
  DRIFTER_SPEED,
  FLARE_BLOOM,
  FLARE_CHARGE,
  FLARE_INTERVAL,
  FLARE_RADIUS,
  GLOAMFIN_CHASE_SPEED,
  GLOAMFIN_CORNER_SPEED,
  GLOAMFIN_GIVEUP,
  GLOAMFIN_HEAR,
  GLOAMFIN_PING_INTERVAL,
  GLOAMFIN_PING_MIN_GAP,
  GLOAMFIN_PING_RANGE,
  GLOAMFIN_RAMP_TIME,
  GLOAMFIN_SEARCH_DELAY,
  GLOAMFIN_SEARCH_ROAM,
  LANTERN_RANGE_BASE,
  LANTERN_RANGE_GAIN,
  LINGER_TIME,
  PREDATOR_SPEED,
  ROSTER_ADD_ORDER,
  ROSTER_CAP,
  ROSTER_CAP_DEPTH,
  type CueName,
  type PredatorKind,
} from "./constants";
import { centerX, centerY, distance, perpendicular } from "./grid";
import { inkBlinds, inkCovers, inkCrosses } from "./ink";
import {
  firstStepToward,
  foragerCanEnter,
  isDen,
  isGate,
  predatorCanEnter,
} from "./maze";
import { moveBody, bodyTile, wanderDirection, type Body } from "./entities";
import { lineOfSightClear } from "./sensing";
import { castPulse } from "./sonar";
import type { Draws } from "./rng";
import type {
  Heading,
  InkCloudState,
  MazeState,
  PredatorState,
  PulseState,
  Tile,
} from "./state";

/**
 * How long the bloom art's fade plays for after a flare is over. The
 * specification calls it short and fixes no figure, so this is the build's. The
 * fade lights nothing: the flare's sense and its light are over when the bloom
 * ends, and only the art plays out.
 */
export const FLARE_FADE = 0.5;

/** How fast the Gloamfin's chase speed climbs back to its cap after a corner. */
const GLOAMFIN_RAMP_RATE =
  (GLOAMFIN_CHASE_SPEED - GLOAMFIN_CORNER_SPEED) / GLOAMFIN_RAMP_TIME;

/** The world a predator senses and travels through on one step. */
export interface PredatorWorld {
  readonly maze: MazeState;
  /** The forager's center, in logical units. */
  readonly fx: number;
  readonly fy: number;
  /** The tile the forager stands on. */
  readonly ftx: number;
  readonly fty: number;
  /** The forager's brightness `G`. */
  readonly brightness: number;
  readonly inkClouds: readonly InkCloudState[];
}

/** The bloom a Flarefish is lighting the maze with this step. */
export interface Bloom {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/** What one step of a predator left behind. */
export interface PredatorStep {
  readonly predator: PredatorState;
  /** The wavefronts it cast this step. */
  readonly pulses: readonly PulseState[];
  /** The cues this step raised. */
  readonly cues: readonly CueName[];
  /** The bloom lighting the maze this step, or `null` while none burns. */
  readonly bloom: Bloom | null;
}

// ---- The roster ---------------------------------------------------------

/**
 * The roster a maze of depth `d` holds, in release order
 * (`specs/predators.md`). Depth `1` holds one of each kind; each depth beyond
 * adds one more, cycling `ROSTER_ADD_ORDER`; and the roster holds at
 * `ROSTER_CAP` of each kind from `ROSTER_CAP_DEPTH` on.
 */
export function rosterForDepth(depth: number): PredatorKind[] {
  const kinds: PredatorKind[] = [...DEN_ORDER];
  const capped = Math.min(Math.max(depth, 1), ROSTER_CAP_DEPTH);
  const added = Math.min(capped - 1, DEN_ORDER.length * (ROSTER_CAP - 1));
  for (let i = 0; i < added; i++) {
    kinds.push(ROSTER_ADD_ORDER[i % ROSTER_ADD_ORDER.length]);
  }
  return kinds;
}

/** The speed a predator of `kind` wanders at. */
export function wanderSpeed(kind: PredatorKind): number {
  // An undetected Lanternjaw drifts at the bonus drifter's pace, on the drifter's
  // own routing, so the two amber lights cannot be told apart.
  return kind === "lanternjaw" ? DRIFTER_SPEED : PREDATOR_SPEED;
}

/**
 * The speed a predator of `kind` opens a chase at. The Gloamfin's is the value
 * it carries and a corner knocks down; the other two hold theirs.
 */
export function chaseSpeedOf(kind: PredatorKind): number {
  return kind === "gloamfin" ? GLOAMFIN_CHASE_SPEED : PREDATOR_SPEED;
}

/** The light detection range `R` the Lanternjaw and the Flarefish have at `g`. */
export function detectRange(g: number): number {
  return LANTERN_RANGE_BASE + LANTERN_RANGE_GAIN * g;
}

/** Whether the Flarefish's pre-bloom charge-up glow is showing. */
export function flareCharging(p: PredatorState): boolean {
  return p.flarePhase !== null && p.flarePhase < FLARE_CHARGE;
}

/** Whether the Flarefish's bloom is burning. */
export function flaring(p: PredatorState): boolean {
  return p.flarePhase !== null && p.flarePhase >= FLARE_CHARGE;
}

/** The bloom's current lit radius, `0` when it is not flaring. */
export function flareRadius(p: PredatorState): number {
  return flaring(p) ? FLARE_RADIUS : 0;
}

/** A predator of `kind` resting on `(tx, ty)`, unreleased, at slot `slot`. */
export function createPredator(
  kind: PredatorKind,
  tx: number,
  ty: number,
  slot: number,
): PredatorState {
  return {
    kind,
    x: centerX(tx),
    y: centerY(ty),
    facing: "up",
    heading: null,
    mode: "den",
    released: false,
    mind: true,
    travel: true,
    speed: 0,
    releaseIn: slot * DEN_RELEASE_GAP,
    fix: null,
    linger: 0,
    alertIn: 0,
    markIn: 0,
    lit: false,
    chaseSpeed: GLOAMFIN_CHASE_SPEED,
    pingIn: GLOAMFIN_PING_INTERVAL,
    pingGap: 0,
    hearingLock: false,
    searchIn: 0,
    searchPingIn: null,
    flareIn: FLARE_INTERVAL,
    flarePhase: null,
    flareFadeIn: 0,
  };
}

/**
 * The predator in the den chamber, holding a fix on nothing and drawn nowhere,
 * which is what `setPredatorState(index, "den")` poses
 * (`specs/instrumentation.md`).
 *
 * It moves the predator nowhere and leaves its `released` flag, its mind and its
 * travel as they stand, so a released predator posed into the chamber swims out
 * through the gate from there and an unreleased one waits its slot.
 */
export function denPose(p: PredatorState): PredatorState {
  return {
    ...p,
    mode: "den",
    heading: null,
    speed: 0,
    fix: null,
    linger: 0,
    alertIn: 0,
    markIn: 0,
    searchIn: 0,
    searchPingIn: null,
    flarePhase: null,
  };
}

/**
 * A predator the debug surface added: loose and patrolling on `(tx, ty)`, its
 * slot behind it, its mind and its travel running
 * (`specs/instrumentation.md`).
 *
 * It carries no release time, because the staggered schedule runs on the roster a
 * maze is laid out with rather than on one added mid-scenario.
 */
export function addedPredator(
  kind: PredatorKind,
  tx: number,
  ty: number,
): PredatorState {
  return {
    ...createPredator(kind, tx, ty, 0),
    mode: "wander",
    released: true,
    releaseIn: null,
    speed: wanderSpeed(kind),
  };
}

/**
 * The predator with a fix on `(tx, ty)`, chasing.
 *
 * A fix taken on a predator that was not already chasing is a fresh acquisition,
 * so it fires the detection alert and opens the chase at its full speed. The
 * Lanternjaw fires no alert and never reaches this function.
 */
export function acquireFix(
  p: PredatorState,
  tx: number,
  ty: number,
): PredatorState {
  const fresh = p.mode !== "chase";
  return {
    ...p,
    mode: "chase",
    fix: { tx, ty },
    linger: LINGER_TIME,
    searchIn: 0,
    searchPingIn: null,
    flarePhase: null,
    chaseSpeed: fresh ? GLOAMFIN_CHASE_SPEED : p.chaseSpeed,
    alertIn: fresh ? ALERT_TIME : p.alertIn,
  };
}

// ---- Sensing ------------------------------------------------------------

/**
 * Whether a light-hunting predator senses the forager: in range, in line of
 * sight, and clear of ink (`specs/predators/lanternjaw.md`).
 */
function sensesLight(p: PredatorState, w: PredatorWorld): boolean {
  if (inkBlinds(w.inkClouds, p.x, p.y, w.fx, w.fy)) return false;
  const tile = bodyTile(p);
  return (
    distance(p.x, p.y, w.fx, w.fy) <= detectRange(w.brightness) &&
    lineOfSightClear(w.maze, tile.tx, tile.ty, w.ftx, w.fty)
  );
}

/**
 * The chase a light-hunting predator holds this step: the fix follows the forager
 * while the sense holds, holds at the last tile sensed for `LINGER_TIME` after it
 * lapses, and is dropped at once by ink.
 */
function trackLight(
  p: PredatorState,
  dt: number,
  w: PredatorWorld,
): PredatorState {
  if (sensesLight(p, w)) {
    return {
      ...p,
      mode: "chase",
      fix: { tx: w.ftx, ty: w.fty },
      linger: LINGER_TIME,
    };
  }
  if (inkBlinds(w.inkClouds, p.x, p.y, w.fx, w.fy)) {
    return { ...p, mode: "wander", fix: null, linger: 0 };
  }
  if (p.mode === "chase" && p.linger > 0) {
    const linger = p.linger - dt;
    if (linger > 0) return { ...p, mode: "chase", linger };
    return { ...p, mode: "wander", fix: null, linger: 0 };
  }
  return { ...p, mode: "wander", fix: null, linger: 0 };
}

// ---- The den ------------------------------------------------------------

/**
 * One step of a predator that is still in the den.
 *
 * A predator waiting its slot holds a den tile and is drawn nowhere. When its
 * release time arrives `released` becomes true and it swims across the chamber
 * and out through the gate, reporting `"den"` until it is out. A predator with no
 * release time at all is one the debug surface added, and it waits here only for
 * as long as a caller poses it unreleased.
 */
function stepDen(
  p: PredatorState,
  dt: number,
  w: PredatorWorld,
): PredatorState {
  let current = p;
  if (!current.released) {
    if (current.releaseIn === null)
      return { ...current, heading: null, speed: 0 };
    const releaseIn = current.releaseIn - dt;
    if (releaseIn > 0) {
      return { ...current, releaseIn, heading: null, speed: 0 };
    }
    current = { ...current, released: true, releaseIn: 0 };
  }

  const gate = w.maze.gate;
  if (gate === null) return { ...current, heading: null, speed: 0 };

  const speed = wanderSpeed(current.kind);
  // Crossing the chamber to the gate is travel, so a predator whose travel is off
  // has its slot turn its `released` flag over and then holds in the den, at the
  // rate that crossing carries (`specs/instrumentation.md`).
  if (!current.travel) return { ...current, heading: null, speed };

  const target = { tx: gate.tx, ty: gate.ty - 1 };
  const canEnter = (tx: number, ty: number): boolean =>
    predatorCanEnter(w.maze, tx, ty);
  const routeFrom = (body: Body): Heading => {
    const tile = bodyTile(body);
    return firstStepToward(
      w.maze,
      tile.tx,
      tile.ty,
      target.tx,
      target.ty,
      canEnter,
    );
  };
  const moved = moveBody(current, {
    maze: w.maze,
    speed,
    dt,
    canEnter,
    request: routeFrom(current),
    decide: routeFrom,
  });

  const tile = bodyTile(moved);
  const out =
    !isDen(w.maze, tile.tx, tile.ty) && !isGate(w.maze, tile.tx, tile.ty);
  return { ...current, ...moved, speed, mode: out ? "wander" : "den" };
}

// ---- Per-kind minds -----------------------------------------------------

function stepLanternjaw(
  p: PredatorState,
  dt: number,
  w: PredatorWorld,
): PredatorState {
  const tracked = trackLight(p, dt, w);
  return {
    ...tracked,
    speed:
      tracked.mode === "chase" ? PREDATOR_SPEED : wanderSpeed("lanternjaw"),
  };
}

function stepGloamfin(
  p: PredatorState,
  index: number,
  dt: number,
  w: PredatorWorld,
): { predator: PredatorState; pulses: PulseState[]; cues: CueName[] } {
  const pulses: PulseState[] = [];
  const cues: CueName[] = [];
  let current: PredatorState = { ...p, pingGap: Math.max(0, p.pingGap - dt) };

  // Close hearing works in the dark, through rock, and through ink, and while it
  // holds the fix follows the forager step by step.
  const hearingLock =
    distance(current.x, current.y, w.fx, w.fy) <= GLOAMFIN_HEAR;
  if (hearingLock) current = acquireFix(current, w.ftx, w.fty);
  current = { ...current, hearingLock };

  const cast = (tint: "violet" | "orange"): void => {
    const tile = bodyTile(current);
    pulses.push(
      castPulse(
        w.maze,
        tile.tx,
        tile.ty,
        GLOAMFIN_PING_RANGE,
        "gloamfin",
        tint,
        index,
      ),
    );
    cues.push(CUES.predatorPing);
    current = {
      ...current,
      pingIn: GLOAMFIN_PING_INTERVAL,
      pingGap: GLOAMFIN_PING_MIN_GAP,
    };
  };

  // The ping timer runs down in every state, and a Gloamfin holding a close-range
  // lock is silent for as long as it holds it.
  current = { ...current, pingIn: current.pingIn - dt };
  if (current.pingIn <= 0 && current.pingGap <= 0 && !hearingLock)
    cast("violet");

  const chased = current.fix;
  if (current.mode === "chase" && chased !== null) {
    const tile = bodyTile(current);
    const chaseSpeed = Math.min(
      GLOAMFIN_CHASE_SPEED,
      current.chaseSpeed + GLOAMFIN_RAMP_RATE * dt,
    );
    current = { ...current, chaseSpeed, speed: chaseSpeed };
    const foragerThere = w.ftx === tile.tx && w.fty === tile.ty;
    if (tile.tx === chased.tx && tile.ty === chased.ty && !foragerThere) {
      current = {
        ...current,
        mode: "search",
        speed: PREDATOR_SPEED,
        searchIn: GLOAMFIN_GIVEUP,
        searchPingIn: GLOAMFIN_SEARCH_DELAY,
      };
    }
  } else if (current.mode === "search") {
    current = {
      ...current,
      speed: PREDATOR_SPEED,
      searchIn: current.searchIn - dt,
    };
    if (current.searchPingIn !== null) {
      const searchPingIn = current.searchPingIn - dt;
      current = { ...current, searchPingIn };
      // The one guaranteed ping of a search waits on the same floor between pings
      // and the same silence under a hearing lock as any other.
      if (searchPingIn <= 0 && current.pingGap <= 0 && !hearingLock) {
        cast("orange");
        current = { ...current, searchPingIn: null };
      }
    }
    if (current.searchIn <= 0) {
      current = {
        ...current,
        mode: "wander",
        fix: null,
        searchIn: 0,
        searchPingIn: null,
      };
    }
  } else {
    current = { ...current, mode: "wander", fix: null, speed: PREDATOR_SPEED };
  }

  return { predator: current, pulses, cues };
}

function stepFlarefish(
  p: PredatorState,
  dt: number,
  w: PredatorWorld,
): { predator: PredatorState; cues: CueName[]; bloom: Bloom | null } {
  const cues: CueName[] = [];
  let current: PredatorState = { ...p, speed: PREDATOR_SPEED };
  let bloom: Bloom | null = null;

  if (current.mode !== "chase") {
    // The flare timer runs down only while it wanders with no flare in progress,
    // and the tick that runs it out is spent on the timer, so the charge-up gets
    // its own whole `FLARE_CHARGE` from the next tick on.
    if (current.flarePhase === null) {
      const flareIn = current.flareIn - dt;
      current =
        flareIn <= 0
          ? { ...current, flareIn: 0, flarePhase: 0 }
          : { ...current, flareIn };
    } else {
      const before = current.flarePhase;
      const phase = before + dt;
      current = { ...current, flarePhase: phase };
      if (before < FLARE_CHARGE && phase >= FLARE_CHARGE) cues.push(CUES.flare);
      if (phase >= FLARE_CHARGE && phase < FLARE_CHARGE + FLARE_BLOOM) {
        bloom = { x: current.x, y: current.y, radius: FLARE_RADIUS };
        // The bloom is a sense as well as a light, and it reaches far past the
        // ordinary one. It ends at once when it locks on.
        const blinded =
          inkCovers(w.inkClouds, current.x, current.y) ||
          inkCovers(w.inkClouds, w.fx, w.fy) ||
          inkCrosses(w.inkClouds, current.x, current.y, w.fx, w.fy);
        if (
          !blinded &&
          distance(current.x, current.y, w.fx, w.fy) <= FLARE_RADIUS
        ) {
          current = acquireFix(current, w.ftx, w.fty);
          current = {
            ...current,
            flareFadeIn: FLARE_FADE,
            flareIn: FLARE_INTERVAL,
          };
        }
      } else if (phase >= FLARE_CHARGE + FLARE_BLOOM) {
        current = {
          ...current,
          flarePhase: null,
          flareFadeIn: FLARE_FADE,
          flareIn: FLARE_INTERVAL,
        };
      }
    }
  }

  if (current.mode !== "chase" && sensesLight(current, w)) {
    current = acquireFix(current, w.ftx, w.fty);
  }

  if (current.mode === "chase") {
    // A chasing Flarefish neither charges nor blooms, so it gives off no tell.
    const tracked = trackLight({ ...current, flarePhase: null }, dt, w);
    // Returning to a wander puts the next flare a whole interval away, so the
    // forager has a window to get clear.
    current =
      tracked.mode === "wander"
        ? { ...tracked, flareIn: FLARE_INTERVAL, speed: PREDATOR_SPEED }
        : { ...tracked, speed: PREDATOR_SPEED };
  }

  return { predator: current, cues, bloom };
}

// ---- Steering -----------------------------------------------------------

/** How a predator is steered this step, given the mind it has just run. */
function steer(
  p: PredatorState,
  dt: number,
  w: PredatorWorld,
  draws: Draws,
): PredatorState {
  // Travel is the carrying out of what the mind has just decided, so a predator
  // whose travel is off holds the tile it stands on and rests there, whatever it
  // decided and however long the scenario runs (`specs/instrumentation.md`).
  if (!p.travel) return { ...p, heading: null };

  const canEnter = (tx: number, ty: number): boolean =>
    foragerCanEnter(w.maze, tx, ty);
  const routeTo = (body: Body, goal: Tile): Heading => {
    const tile = bodyTile(body);
    return firstStepToward(
      w.maze,
      tile.tx,
      tile.ty,
      goal.tx,
      goal.ty,
      canEnter,
    );
  };

  let request: Heading = null;
  let decide: (body: Body) => Heading;
  const fix = p.fix;

  if (p.mode === "chase" && fix !== null) {
    // Every step of a chase is the first step of a shortest corridor route to the
    // fixed tile, so a hunter rounds the rock between it and its fix.
    request = routeTo(p, fix);
    decide = (body) => routeTo(body, fix);
  } else if (p.mode === "search" && fix !== null) {
    const roam = (body: Body): Heading => {
      const tile = bodyTile(body);
      const away = Math.abs(tile.tx - fix.tx) + Math.abs(tile.ty - fix.ty);
      return away > GLOAMFIN_SEARCH_ROAM
        ? routeTo(body, fix)
        : wanderDirection(body, w.maze, canEnter, draws);
    };
    decide = roam;
  } else {
    decide = (body) => wanderDirection(body, w.maze, canEnter, draws);
  }

  const moved = moveBody(p, {
    maze: w.maze,
    speed: p.speed,
    dt,
    canEnter,
    request,
    decide,
  });

  // The Gloamfin's corner brake: turning onto a perpendicular direction mid-chase
  // costs it its edge over the forager, and time gives it back.
  const cornered =
    p.kind === "gloamfin" &&
    p.mode === "chase" &&
    p.heading !== null &&
    moved.heading !== null &&
    perpendicular(p.heading, moved.heading);

  return {
    ...p,
    ...moved,
    chaseSpeed: cornered ? GLOAMFIN_CORNER_SPEED : p.chaseSpeed,
    speed: cornered && p.mode === "chase" ? GLOAMFIN_CORNER_SPEED : p.speed,
  };
}

// ---- The step -----------------------------------------------------------

/**
 * One step of a predator: its timers, its own mind, and the travel that follows.
 *
 * `index` is its place in the roster, which is what a ping it casts is attributed
 * to.
 */
/**
 * The predator's windows run down by `dt`: its detection alert, its sonar mark,
 * and the bloom art's fade.
 *
 * These are consequences rather than decisions, so they run whether or not the
 * creatures' own minds are on (`specs/instrumentation.md`): a pulse still marks a
 * held predator and the mark still expires on its own schedule.
 */
export function coolPredator(p: PredatorState, dt: number): PredatorState {
  return {
    ...p,
    alertIn: Math.max(0, p.alertIn - dt),
    markIn: Math.max(0, p.markIn - dt),
    flareFadeIn: Math.max(0, p.flareFadeIn - dt),
  };
}

export function stepPredator(
  p: PredatorState,
  index: number,
  dt: number,
  w: PredatorWorld,
  draws: Draws,
): PredatorStep {
  const ticked = coolPredator(p, dt);

  if (ticked.mode === "den") {
    return {
      predator: stepDen(ticked, dt, w),
      pulses: [],
      cues: [],
      bloom: null,
    };
  }

  let current = ticked;
  let pulses: readonly PulseState[] = [];
  let cues: readonly CueName[] = [];
  let bloom: Bloom | null = null;

  switch (current.kind) {
    case "lanternjaw":
      current = stepLanternjaw(current, dt, w);
      break;
    case "gloamfin": {
      const out = stepGloamfin(current, index, dt, w);
      current = out.predator;
      pulses = out.pulses;
      cues = out.cues;
      break;
    }
    case "flarefish": {
      const out = stepFlarefish(current, dt, w);
      current = out.predator;
      cues = out.cues;
      bloom = out.bloom;
      break;
    }
  }

  return { predator: steer(current, dt, w, draws), pulses, cues, bloom };
}
