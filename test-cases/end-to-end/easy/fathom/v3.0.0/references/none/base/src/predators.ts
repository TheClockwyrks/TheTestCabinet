// Fathom — the three hunters.
//
// Each is keyed to a different signal the forager gives off: the Lanternjaw
// tracks light, the Gloamfin tracks sound, the Flarefish hunts in the flash of
// its own flare (`specs/predators.md` and the files under `specs/predators/`).
// This module owns the den schedule, each kind's sense and tell, the detection
// alert, and the route each takes; the tile-locked stepping itself is in
// `entities.ts`.

import {
  ALERT_TIME,
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
  GLOAMFIN_RAMP_TIME,
  GLOAMFIN_SEARCH_DELAY,
  GLOAMFIN_SEARCH_ROAM,
  LANTERN_RANGE_BASE,
  LANTERN_RANGE_GAIN,
  LINGER_TIME,
  PREDATOR_SPEED,
} from "./constants";
import type { CueName } from "./constants";
import {
  advance,
  Drifter,
  Forager,
  Predator,
  turnedCorner,
  wanderDir,
} from "./entities";
import type { CanEnter, Maze } from "./maze";
import type { Rng } from "./rng";
import { lineOfSightClear } from "./sensing";
import type { Cell, Heading } from "./types";

/**
 * How long the bloom art collapses and dims for after the flare is over. The
 * specification fixes the charge and the bloom and leaves this beat open, and
 * nothing senses or lights during it.
 */
export const FLARE_FADE = 0.5;

/** How fast a knocked-down chase speed climbs back to its cap. */
const CHASE_RAMP_RATE =
  (GLOAMFIN_CHASE_SPEED - GLOAMFIN_CORNER_SPEED) / GLOAMFIN_RAMP_TIME;

/** What a predator needs of the rest of the game to take its step. */
export interface PredatorWorld {
  maze: Maze;
  rng: Rng;
  forager: Forager;
  predators: Predator[];
  drifters: Drifter[];
  /** Whether a point lies inside an ink cloud. */
  inkAt: (x: number, y: number) => boolean;
  /** Whether the segment between two points passes through an ink cloud. */
  inkBetween: (x1: number, y1: number, x2: number, y2: number) => boolean;
  /** Cast one of this Gloamfin's own pings, ordinary or the lost-you one. */
  castPing: (predator: Predator, lostYou: boolean) => void;
  /** Draw the detection-alert flash for a predator that just took a fix. */
  showAlert: (predator: Predator) => void;
  /** Play one of the game's cues, once on this tick. */
  playCue: (cue: CueName) => void;
}

/** Whether a predator is pursuing a fix. Asked as a call, so the narrowing a
 * literal comparison would impose does not survive the mutations below. */
function chasing(p: Predator): boolean {
  return p.state === "chase";
}

function separation(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/** The light detection range R the Lanternjaw and the Flarefish share. */
export function lightDetectRange(brightness: number): number {
  return LANTERN_RANGE_BASE + LANTERN_RANGE_GAIN * brightness;
}

/** Whether a Flarefish's bloom is burning, which lights a disc and can lock on. */
export function isBlooming(p: Predator): boolean {
  return p.kind === "flarefish" && p.flarePhase === "bloom";
}

/** Whether a Flarefish's pre-bloom charge-up glow is showing. */
export function isCharging(p: Predator): boolean {
  return p.kind === "flarefish" && p.flarePhase === "charge";
}

/** Whether ink blinds a light hunter this instant. */
function blindedByInk(p: Predator, w: PredatorWorld): boolean {
  return w.inkAt(p.x, p.y) || w.inkBetween(p.x, p.y, w.forager.x, w.forager.y);
}

/** The light sense the Lanternjaw and the Flarefish share. */
function lightSense(p: Predator, w: PredatorWorld): boolean {
  if (blindedByInk(p, w)) return false;
  const r = lightDetectRange(w.forager.brightness);
  if (separation(p.x, p.y, w.forager.x, w.forager.y) > r) return false;
  return lineOfSightClear(w.maze, p.col, p.row, w.forager.col, w.forager.row);
}

/**
 * Take a fix on a tile. A fix the predator was not already chasing on is a fresh
 * acquisition: it opens the chase at full speed and fires the detection alert.
 * Refreshing a fix already being chased fires nothing.
 */
export function acquire(p: Predator, w: PredatorWorld, tile: Cell): void {
  const fresh = p.state !== "chase";
  p.fix = { ...tile };
  p.state = "chase";
  if (!fresh) return;
  p.chaseSpeed = GLOAMFIN_CHASE_SPEED;
  p.alertT = ALERT_TIME;
  w.showAlert(p);
}

// ---- The Lanternjaw --------------------------------------------------------

function updateLanternjaw(p: Predator, dt: number, w: PredatorWorld): void {
  if (lightSense(p, w)) {
    p.fix = w.forager.tile;
    p.linger = LINGER_TIME;
    p.state = "chase";
  } else if (blindedByInk(p, w)) {
    // Ink is immediate: the fix drops at once, with no linger.
    p.fix = null;
    p.linger = 0;
    p.state = "wander";
  } else if (p.linger > 0) {
    p.linger -= dt;
    p.state = "chase";
    if (p.linger <= 0) {
      p.fix = null;
      p.state = "wander";
    }
  } else {
    p.fix = null;
    p.state = "wander";
  }
  // Undetected it drifts at exactly the bonus drifter's pace, on the drifter's
  // own routing, so its bulb cannot be told from a drifter's until it finds you.
  p.speed = p.state === "chase" ? PREDATOR_SPEED : DRIFTER_SPEED;
}

// ---- The Gloamfin ----------------------------------------------------------

function beginSearch(p: Predator): void {
  p.state = "search";
  p.searchTimer = GLOAMFIN_GIVEUP;
  p.searchPingTimer = GLOAMFIN_SEARCH_DELAY;
  p.searchPinged = false;
  p.speed = PREDATOR_SPEED;
}

function updateGloamfin(p: Predator, dt: number, w: PredatorWorld): void {
  if (p.pingGap > 0) p.pingGap = Math.max(0, p.pingGap - dt);

  // Close hearing works in the dark, through rock, and through ink, and holds
  // the fix on the forager step by step for as long as it lasts.
  p.hearingLock =
    separation(p.x, p.y, w.forager.x, w.forager.y) <= GLOAMFIN_HEAR;
  if (p.hearingLock) acquire(p, w, w.forager.tile);

  // The ping timer runs down whatever the Gloamfin is doing, and the ping waits
  // on the minimum gap and on the hearing lock rather than being skipped.
  p.pingTimer -= dt;
  if (p.pingTimer <= 0 && p.pingGap <= 0 && !p.hearingLock) {
    w.castPing(p, false);
  }

  if (p.state === "search") {
    p.speed = PREDATOR_SPEED;
    p.searchTimer -= dt;
    if (!p.searchPinged) {
      p.searchPingTimer -= dt;
      if (p.searchPingTimer <= 0 && p.pingGap <= 0 && !p.hearingLock) {
        w.castPing(p, true);
        p.searchPinged = true;
      }
    }
    if (p.searchTimer <= 0) {
      p.fix = null;
      p.state = "wander";
    }
    return;
  }

  if (p.state === "chase" && p.fix) {
    p.chaseSpeed = Math.min(
      GLOAMFIN_CHASE_SPEED,
      p.chaseSpeed + CHASE_RAMP_RATE * dt,
    );
    p.speed = p.chaseSpeed;
    const arrived = p.col === p.fix.col && p.row === p.fix.row;
    const foragerThere =
      w.forager.col === p.fix.col && w.forager.row === p.fix.row;
    if (arrived && !foragerThere) beginSearch(p);
    return;
  }

  p.state = "wander";
  p.fix = null;
  p.speed = PREDATOR_SPEED;
}

/** Set a Gloamfin's ping timers after it casts, whichever ping it was. */
export function armPingTimers(p: Predator): void {
  p.pingTimer = GLOAMFIN_PING_INTERVAL;
  p.pingGap = GLOAMFIN_PING_MIN_GAP;
}

// ---- The Flarefish ---------------------------------------------------------

/** Back to wandering, with the next flare a whole interval away. */
function loseFlarefishChase(p: Predator): void {
  p.fix = null;
  p.linger = 0;
  p.state = "wander";
  p.flarePhase = "none";
  p.flarePhaseT = 0;
  p.flareTimer = FLARE_INTERVAL;
}

/**
 * The flare: a timer that runs only while the Flarefish wanders unflared, then
 * a charge-up, then a bloom that both lights a disc and senses through it. The
 * fade after the bloom is art alone, and the timer runs through it, so
 * consecutive charge-ups stand a bloom's length plus a whole interval apart.
 */
function runFlareCycle(p: Predator, dt: number, w: PredatorWorld): void {
  switch (p.flarePhase) {
    case "none":
      p.flareTimer -= dt;
      if (p.flareTimer <= 0) {
        p.flarePhase = "charge";
        p.flarePhaseT = 0;
      }
      return;
    case "charge":
      p.flarePhaseT += dt;
      if (p.flarePhaseT >= FLARE_CHARGE) {
        p.flarePhase = "bloom";
        p.flarePhaseT = 0;
        w.playCue("flare");
      }
      return;
    case "bloom":
      p.flarePhaseT += dt;
      tryFlareLock(p, w);
      if (p.flarePhase !== "bloom") return;
      if (p.flarePhaseT >= FLARE_BLOOM) {
        p.flarePhase = "fade";
        p.flarePhaseT = 0;
        p.flareTimer = FLARE_INTERVAL;
      }
      return;
    case "fade":
      p.flarePhaseT += dt;
      p.flareTimer -= dt;
      if (p.flarePhaseT >= FLARE_FADE) {
        p.flarePhase = "none";
        p.flarePhaseT = 0;
      }
      return;
  }
}

/**
 * The bloom is a sense as well as a light, reaching far past the ordinary one.
 * It holds across the whole bloom rather than at its opening instant, and the
 * bloom ends the moment it locks on.
 */
function tryFlareLock(p: Predator, w: PredatorWorld): void {
  if (separation(p.x, p.y, w.forager.x, w.forager.y) > FLARE_RADIUS) return;
  if (blindedByInk(p, w) || w.inkAt(w.forager.x, w.forager.y)) {
    return;
  }
  acquire(p, w, w.forager.tile);
  p.linger = LINGER_TIME;
  p.flarePhase = "none";
  p.flarePhaseT = 0;
}

function updateFlarefish(p: Predator, dt: number, w: PredatorWorld): void {
  p.speed = PREDATOR_SPEED;

  if (!chasing(p)) {
    runFlareCycle(p, dt, w);
    if (!chasing(p) && lightSense(p, w)) {
      acquire(p, w, w.forager.tile);
      p.linger = LINGER_TIME;
    }
    if (!chasing(p)) {
      p.state = "wander";
      p.fix = null;
      return;
    }
    // It has just taken a fix, and a chasing Flarefish neither charges nor
    // blooms, so whatever beat was playing is over.
    p.flarePhase = "none";
    p.flarePhaseT = 0;
  }

  // Chasing it neither charges nor blooms, so it gives off no tell at all.
  if (lightSense(p, w)) {
    p.fix = w.forager.tile;
    p.linger = LINGER_TIME;
  } else if (blindedByInk(p, w)) {
    loseFlarefishChase(p);
  } else {
    p.linger -= dt;
    if (p.linger <= 0) loseFlarefishChase(p);
  }
}

// ---- The den ---------------------------------------------------------------

/**
 * Wait out the staggered release, then swim across the chamber and out through
 * the gate. `state` stays `"den"` until the predator is out of the chamber.
 * Returns once the predator has taken its step for this tick.
 */
function updateInDen(p: Predator, dt: number, w: PredatorWorld): void {
  if (!p.released) {
    p.denTimer -= dt;
    if (p.denTimer > 0) {
      p.dir = null;
      return;
    }
    p.released = true;
  }

  const gate = w.maze.gate;
  if (!gate) {
    // A board with no den has nowhere to leave from, so it is held out of play.
    p.dir = null;
    return;
  }

  p.speed = PREDATOR_SPEED;
  if (!p.travel) {
    // Crossing the chamber to the gate is travel, so a predator with its travel
    // off waits its slot out, turns its `released` flag over, and holds in the
    // den from there.
    p.dir = null;
    return;
  }

  const canLeave: CanEnter = (c, r) => w.maze.isDenOpen(c, r);
  advance(
    p,
    dt,
    w.maze,
    () =>
      w.maze.firstStepToward(p.col, p.row, gate.col, gate.row - 1, canLeave),
    canLeave,
  );
  if (w.maze.isCorridor(p.col, p.row)) p.state = "wander";
}

// ---- The step --------------------------------------------------------------

/** Where a predator may stand once it is out of the den: corridor alone. */
function corridorOnly(w: PredatorWorld): CanEnter {
  return (c, r) => w.maze.isCorridor(c, r);
}

/** Manhattan distance in tiles, which the search roam is measured in. */
function tileDistance(a: Cell, b: Cell): number {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

/**
 * The direction a predator wants next: the first step of a shortest corridor
 * route to its fix while it chases, a cast about the fix while it searches, and
 * a wander otherwise. A predator with no route, or already standing on its fix,
 * holds where it is.
 */
function wantDir(p: Predator, w: PredatorWorld, canEnter: CanEnter): Heading {
  if (p.state === "search" && p.fix) {
    if (tileDistance(p.tile, p.fix) > GLOAMFIN_SEARCH_ROAM) {
      return w.maze.firstStepToward(
        p.col,
        p.row,
        p.fix.col,
        p.fix.row,
        canEnter,
      );
    }
    return wanderDir(p, w.maze, w.rng, canEnter);
  }
  if (p.state === "chase" && p.fix) {
    return w.maze.firstStepToward(p.col, p.row, p.fix.col, p.fix.row, canEnter);
  }
  return wanderDir(p, w.maze, w.rng, canEnter);
}

/**
 * Run down the two windows a predator's body is DRAWN for: its sonar mark and
 * its detection alert.
 *
 * Separate from the step below because these are presentation rather than
 * sense. A predator whose mind is off decides nothing and so holds exactly where
 * it stands, and a mark or an alert already showing still fades out on time.
 */
export function decayPredatorTimers(p: Predator, dt: number): void {
  if (p.markT > 0) p.markT = Math.max(0, p.markT - dt);
  if (p.alertT > 0) p.alertT = Math.max(0, p.alertT - dt);
}

/**
 * Advance one predator by `dt`: its timers, its sense, and its step. Its own
 * mind is what runs here, so this is called only for a predator that has one.
 */
export function updatePredator(
  p: Predator,
  dt: number,
  w: PredatorWorld,
): void {
  decayPredatorTimers(p, dt);

  if (p.state === "den") {
    updateInDen(p, dt, w);
    return;
  }

  switch (p.kind) {
    case "lanternjaw":
      updateLanternjaw(p, dt, w);
      break;
    case "gloamfin":
      updateGloamfin(p, dt, w);
      break;
    case "flarefish":
      updateFlarefish(p, dt, w);
      break;
  }

  const canEnter = corridorOnly(w);
  const before = p.dir;
  if (p.travel) {
    advance(p, dt, w.maze, () => wantDir(p, w, canEnter), canEnter);
  } else {
    // Travel is the carrying out of what the mind decided. With it off the mind
    // above has run in full — it sensed, took or lapsed its fix, fired its alert
    // and settled its `state` and its speed — and only the body holds still.
    p.dir = null;
  }

  // A corner costs a chasing Gloamfin its edge: it drops below the forager's own
  // speed and climbs back over the ramp time. A straight run and a reversal are
  // not turns and leave it alone.
  if (
    p.kind === "gloamfin" &&
    p.state === "chase" &&
    turnedCorner(before, p.dir)
  ) {
    p.chaseSpeed = GLOAMFIN_CORNER_SPEED;
  }
}
