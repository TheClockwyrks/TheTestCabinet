// Fathom — the three predators' minds.
//
// Each hunts a different signal the forager gives off: the Lanternjaw tracks
// the light, the Gloamfin tracks the sound, and the Flarefish sees only what
// its own flare shows it. This module owns the den swim, each kind's sense, the
// detection alert, the flare cycle and the ping cadence, and the direction a
// hunter wants next; the tile-locked stepping it wants is in
// `src/movement.ts`.

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
import type { Cell } from "./grid";
import { isTurn, sameCell, tileDistance } from "./grid";
import type { Forager, Predator } from "./creatures";
import { wanderIntent } from "./creatures";
import { lineOfSightClear } from "./fog";
import type { InkCloud } from "./ink";
import { inkBetween, inkCovers } from "./ink";
import type { Maze } from "./maze";
import type { Intent } from "./movement";
import { advanceBody, bodyCell } from "./movement";
import type { Rng } from "./rng";
import type { PulseTint } from "./sonar";

/** How long a fade of the bloom's art plays out once a bloom is over. */
export const FLARE_FADE = 0.5;

/** What the maze around a hunter offers it, and what it raises back. */
export interface Trench {
  readonly maze: Maze;
  readonly forager: Forager;
  readonly clouds: readonly InkCloud[];
  readonly rng: Rng;
  /** Casts one of the Gloamfin's own pings from where it stands. */
  ping(predator: Predator, tint: PulseTint): void;
  /** A fresh acquisition, which is where the alert's cue and flash hang. */
  acquired(predator: Predator): void;
  /** A bloom opening, which is where the flare's cue hangs. */
  bloomed(predator: Predator): void;
}

/** How fast the Gloamfin's chase speed climbs back after a corner. */
const RAMP_RATE =
  (GLOAMFIN_CHASE_SPEED - GLOAMFIN_CORNER_SPEED) / GLOAMFIN_RAMP_TIME;

/** `R`, the light detection range the Lanternjaw and the Flarefish share. */
export function lightDetectRange(brightness: number): number {
  return LANTERN_RANGE_BASE + LANTERN_RANGE_GAIN * brightness;
}

function separation(predator: Predator, forager: Forager): number {
  return Math.hypot(predator.x - forager.x, predator.y - forager.y);
}

/** Whether ink stands in a hunter's way: on it, or on the line to the forager. */
export function blindedByInk(predator: Predator, trench: Trench): boolean {
  const { clouds, forager } = trench;
  if (inkCovers(clouds, predator.x, predator.y)) return true;
  return inkBetween(clouds, predator.x, predator.y, forager.x, forager.y);
}

/** The light sense: in range, in line of sight, and clear of ink. */
export function sensesLight(predator: Predator, trench: Trench): boolean {
  const { forager, maze } = trench;
  if (separation(predator, forager) > lightDetectRange(forager.brightness)) {
    return false;
  }
  if (blindedByInk(predator, trench)) return false;
  return lineOfSightClear(maze, bodyCell(predator), bodyCell(forager));
}

/**
 * A predator takes a fix on a tile. A fresh acquisition — one taken by a
 * predator that was not already chasing — opens the chase at its full pace and
 * fires the detection alert. The Lanternjaw fires none, and carries its bulb as
 * a standing tell instead.
 */
export function acquireFix(
  predator: Predator,
  trench: Trench,
  cell: Cell,
): boolean {
  const fresh = predator.state !== "chase";
  predator.fix = cell;
  predator.state = "chase";
  predator.linger = LINGER_TIME;
  predator.searchTimer = 0;
  predator.searchPingTimer = 0;
  predator.searchPingSpent = false;
  if (!fresh) return false;
  predator.chaseSpeed = GLOAMFIN_CHASE_SPEED;
  if (predator.kind !== "lanternjaw") {
    predator.alert = ALERT_TIME;
    trench.acquired(predator);
  }
  return true;
}

/**
 * The windows a predator is drawn by, which run down whether or not its own
 * mind is running: a scenario that holds the creatures still still watches an
 * alert and a sonar mark expire.
 */
export function decayPredatorTimers(predator: Predator, dt: number): void {
  predator.alert = Math.max(0, predator.alert - dt);
  predator.mark = Math.max(0, predator.mark - dt);
  predator.flareFade = Math.max(0, predator.flareFade - dt);
}

// ---- The den swim --------------------------------------------------------

function swimOutOfDen(predator: Predator, dt: number, trench: Trench): void {
  const { maze } = trench;
  predator.speed = PREDATOR_SPEED;
  const gate = maze.gate;
  if (!predator.released || gate === null) {
    predator.heading = null;
    return;
  }
  const open = maze.openToPredator;
  const beyond: Cell = { tx: gate.tx, ty: gate.ty - 1 };
  advanceBody(
    predator,
    dt,
    maze,
    () => {
      const here = bodyCell(predator);
      return (
        maze.firstStepToward(here, beyond, open) ??
        maze.firstStepToward(here, gate, open)
      );
    },
    open,
  );
  const here = bodyCell(predator);
  if (!maze.isDen(here.tx, here.ty) && !maze.isGate(here.tx, here.ty)) {
    predator.state = "wander";
  }
}

// ---- The Lanternjaw ------------------------------------------------------

function updateLanternjaw(
  predator: Predator,
  dt: number,
  trench: Trench,
): void {
  const blinded = blindedByInk(predator, trench);
  const senses = !blinded && sensesLight(predator, trench);

  if (senses) {
    predator.fix = bodyCell(trench.forager);
    predator.linger = LINGER_TIME;
    predator.state = "chase";
  } else if (blinded) {
    // Ink is immediate: the fix goes at once, with no linger at all.
    predator.dropFix();
    predator.state = "wander";
  } else if (predator.state === "chase") {
    predator.linger -= dt;
    if (predator.linger <= 0) {
      predator.dropFix();
      predator.state = "wander";
    }
  } else {
    predator.state = "wander";
  }

  // Undetected it drifts at exactly a bonus drifter's pace, and on a drifter's
  // wander, so its bulb cannot be told from one until it finds the forager.
  predator.speed = predator.state === "chase" ? PREDATOR_SPEED : DRIFTER_SPEED;
}

// ---- The Gloamfin --------------------------------------------------------

function castPing(predator: Predator, trench: Trench, tint: PulseTint): void {
  trench.ping(predator, tint);
  predator.pingTimer = GLOAMFIN_PING_INTERVAL;
  predator.pingGap = GLOAMFIN_PING_MIN_GAP;
}

function updateGloamfin(predator: Predator, dt: number, trench: Trench): void {
  const { forager } = trench;
  predator.pingGap = Math.max(0, predator.pingGap - dt);

  // Close hearing works in the dark, through rock, and through ink, and while
  // it holds the fix follows the forager step by step.
  const heard = separation(predator, forager) <= GLOAMFIN_HEAR;
  predator.hearingLock = heard;
  if (heard) acquireFix(predator, trench, bodyCell(forager));

  // The ping timer runs down whatever the Gloamfin is doing. It is silent while
  // it already holds a hearing lock, and pings the moment that lock breaks.
  predator.pingTimer -= dt;
  if (predator.pingTimer <= 0 && predator.pingGap <= 0 && !heard) {
    castPing(predator, trench, "violet");
  }

  if (predator.state === "chase") {
    predator.chaseSpeed = Math.min(
      GLOAMFIN_CHASE_SPEED,
      predator.chaseSpeed + RAMP_RATE * dt,
    );
    predator.speed = predator.chaseSpeed;
    const fix = predator.fix;
    const here = bodyCell(predator);
    if (fix && sameCell(here, fix) && !sameCell(bodyCell(forager), fix)) {
      predator.state = "search";
      predator.searchTimer = GLOAMFIN_GIVEUP;
      predator.searchPingTimer = GLOAMFIN_SEARCH_DELAY;
      predator.searchPingSpent = false;
      predator.speed = PREDATOR_SPEED;
    }
    return;
  }

  predator.speed = PREDATOR_SPEED;

  if (predator.state === "search") {
    predator.searchTimer -= dt;
    if (!predator.searchPingSpent) {
      predator.searchPingTimer -= dt;
      const due = predator.searchPingTimer <= 0;
      if (due && predator.pingGap <= 0 && !heard) {
        castPing(predator, trench, "orange");
        predator.searchPingSpent = true;
      }
    }
    if (predator.searchTimer <= 0) {
      predator.dropFix();
      predator.state = "wander";
    }
    return;
  }

  predator.state = "wander";
}

// ---- The Flarefish -------------------------------------------------------

function loseFlarefishChase(predator: Predator): void {
  predator.dropFix();
  predator.state = "wander";
  predator.endFlare();
  // A whole interval away, so the forager has a window to get clear.
  predator.flareTimer = FLARE_INTERVAL;
}

function runFlareCycle(
  predator: Predator,
  dt: number,
  trench: Trench,
  blinded: boolean,
): void {
  if (!predator.flareActive) {
    predator.flareTimer -= dt;
    if (predator.flareTimer > 0) return;
    // The tick that runs the timer out is spent on the timer, so the charge-up
    // gets its own whole `FLARE_CHARGE` from the next tick on.
    predator.flareActive = true;
    predator.flarePhase = 0;
    predator.flareCharging = true;
    predator.flaring = false;
    predator.flareRadius = 0;
    return;
  }

  const before = predator.flarePhase;
  predator.flarePhase += dt;
  const bloomStart = FLARE_CHARGE;
  const bloomEnd = FLARE_CHARGE + FLARE_BLOOM;
  const burning =
    predator.flarePhase >= bloomStart && predator.flarePhase < bloomEnd;
  predator.flareCharging = predator.flarePhase < bloomStart;
  predator.flaring = burning;
  predator.flareRadius = burning ? FLARE_RADIUS : 0;

  if (before < bloomStart && predator.flarePhase >= bloomStart) {
    trench.bloomed(predator);
  }

  if (burning) {
    const { forager } = trench;
    const inReach = separation(predator, forager) <= FLARE_RADIUS;
    const clear = !blinded && !inkCovers(trench.clouds, forager.x, forager.y);
    if (inReach && clear) {
      // The bloom ends at once when it locks on.
      predator.endFlare();
      predator.flareFade = FLARE_FADE;
      acquireFix(predator, trench, bodyCell(forager));
      return;
    }
  }

  if (before < bloomEnd && predator.flarePhase >= bloomEnd) {
    predator.endFlare();
    predator.flareFade = FLARE_FADE;
    predator.flareTimer = FLARE_INTERVAL;
  }
}

function updateFlarefish(predator: Predator, dt: number, trench: Trench): void {
  predator.speed = PREDATOR_SPEED;
  const blinded = blindedByInk(predator, trench);
  const senses = !blinded && sensesLight(predator, trench);

  if (predator.state === "chase") {
    // A chasing Flarefish neither charges nor blooms, so it shows no tell.
    predator.endFlare();
    if (senses) {
      predator.fix = bodyCell(trench.forager);
      predator.linger = LINGER_TIME;
      return;
    }
    if (blinded) {
      loseFlarefishChase(predator);
      return;
    }
    predator.linger -= dt;
    if (predator.linger <= 0) loseFlarefishChase(predator);
    return;
  }

  predator.state = "wander";
  // The ordinary light sense runs whatever it is doing, so a Flarefish that
  // simply drifts up on a lit forager pursues rather than waiting for a flare.
  if (senses) {
    acquireFix(predator, trench, bodyCell(trench.forager));
    return;
  }
  runFlareCycle(predator, dt, trench, blinded);
}

// ---- Where a hunter wants to go ------------------------------------------

function intentFor(predator: Predator, trench: Trench): Intent {
  const { maze, rng } = trench;
  const open = maze.openToForager;
  const wander = (): ReturnType<Intent> =>
    wanderIntent(predator, maze, rng, open);
  const fix = predator.fix;

  if (predator.state === "search" && fix) {
    return () => {
      const here = bodyCell(predator);
      if (tileDistance(here, fix) <= GLOAMFIN_SEARCH_ROAM) return wander();
      return maze.firstStepToward(here, fix, open) ?? wander();
    };
  }

  if (predator.state === "chase" && fix) {
    // Every step is the first step of a shortest corridor route to the fix, so
    // a hunter rounds the rock between it and the tile it is driving at.
    return () =>
      maze.firstStepToward(bodyCell(predator), fix, open) ?? wander();
  }

  return wander;
}

/** Advances one predator: its sense, then the step that sense asks for. */
export function updatePredator(
  predator: Predator,
  dt: number,
  trench: Trench,
): void {
  if (predator.state === "den") {
    swimOutOfDen(predator, dt, trench);
    return;
  }

  if (predator.kind === "lanternjaw") updateLanternjaw(predator, dt, trench);
  else if (predator.kind === "gloamfin") updateGloamfin(predator, dt, trench);
  else updateFlarefish(predator, dt, trench);

  const before = predator.heading;
  advanceBody(
    predator,
    dt,
    trench.maze,
    intentFor(predator, trench),
    trench.maze.openToForager,
  );

  // A corner costs the Gloamfin its edge: turning onto a perpendicular
  // direction mid-chase drops it below the forager's own speed for a beat.
  const after = predator.heading;
  if (
    predator.kind === "gloamfin" &&
    predator.state === "chase" &&
    before !== null &&
    after !== null &&
    isTurn(before, after)
  ) {
    predator.chaseSpeed = GLOAMFIN_CORNER_SPEED;
  }
}
