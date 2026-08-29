// Fathom — the creatures that travel the maze.
//
// The forager the player swims, the bonus drifters that wander in, and the
// predators the den lets out. Each is a body under `src/movement.ts`; what is
// here is the state each one carries, the wander they share, and the roster a
// depth holds. Their minds are in `src/predators.ts`.

import {
  BRIGHT_HALFLIFE,
  BRIGHT_HOLD,
  BRIGHT_PER_EAT,
  DEN_ORDER,
  DEN_RELEASE_GAP,
  DRIFTER_SPEED,
  FLARE_INTERVAL,
  FORAGER_SPEED,
  GLOAMFIN_CHASE_SPEED,
  GLOAMFIN_PING_INTERVAL,
  PREDATOR_SPEED,
  ROSTER_ADD_ORDER,
  ROSTER_CAP_DEPTH,
} from "./constants";
import type { PredatorKind } from "./constants";
import type { Cell, Dir } from "./grid";
import { opposite, tileCenterX, tileCenterY } from "./grid";
import { DEN_SLOTS } from "./layout";
import type { Maze, TileTest } from "./maze";
import type { Body } from "./movement";
import { bodyCell, restAt } from "./movement";
import type { Rng } from "./rng";
import { visionRadius } from "./fog";

/** What a predator is doing, as the snapshot reports it. */
export type PredatorState = "den" | "wander" | "chase" | "search";

/** The player's forager. */
export class Forager implements Body {
  x = 0;
  y = 0;
  heading: Dir | null = null;
  facing: Dir = "up";
  speed = FORAGER_SPEED;

  /** `G`, the brightness eating raises and time decays. */
  brightness = 0;

  /** What is left of the hold during which `G` is steady. */
  hold = 0;

  /** `V`, the radius of the line-of-sight light pocket. */
  get visionRadius(): number {
    return visionRadius(this.brightness);
  }

  /** Eating a plankton: `G` rises and the hold is armed in full. */
  graze(): void {
    this.brightness = Math.min(1, this.brightness + BRIGHT_PER_EAT);
    this.hold = BRIGHT_HOLD;
  }

  /**
   * The hold runs down first, and `G` decays over whatever is left of the
   * step, so the tick a hold expires on is not a tick of steady brightness.
   */
  advanceLight(dt: number): void {
    let remaining = dt;
    if (this.hold > 0) {
      const spent = Math.min(this.hold, remaining);
      this.hold -= spent;
      remaining -= spent;
      if (this.hold < 1e-9) this.hold = 0;
    }
    if (remaining <= 0) return;
    this.brightness *= Math.pow(0.5, remaining / BRIGHT_HALFLIFE);
  }
}

/** A bonus drifter: harmless, amber, and permanent until it is eaten. */
export class Drifter implements Body {
  x: number;
  y: number;
  heading: Dir | null = null;
  facing: Dir = "left";
  speed = DRIFTER_SPEED;

  /** Whether it runs its own wander, which is how a dive is played. */
  mind = true;

  constructor(cell: Cell) {
    this.x = tileCenterX(cell.tx);
    this.y = tileCenterY(cell.ty);
  }
}

/** One hunter of the roster. */
export class Predator implements Body {
  readonly kind: PredatorKind;

  x = 0;
  y = 0;
  heading: Dir | null = null;
  facing: Dir = "up";
  speed = PREDATOR_SPEED;

  state: PredatorState = "den";

  /** Whether its turn in the staggered schedule has come. */
  released = false;

  /**
   * Its slot, in seconds from the moment live play begins, and `null` for one
   * added outside a roster, which the staggered schedule therefore passes by.
   */
  readonly releaseAt: number | null;

  /** Whether it runs its own mind, which is how a dive is played. */
  mind = true;

  /** The tile it believes the forager is on. */
  fix: Cell | null = null;

  /** What is left of the window it keeps a lapsed fix for. */
  linger = 0;

  /** What is left of its detection alert. */
  alert = 0;

  /** What is left of the window a sonar mark keeps it drawn for. */
  mark = 0;

  // The Gloamfin's own bookkeeping.
  hearingLock = false;
  pingTimer = GLOAMFIN_PING_INTERVAL;
  pingGap = 0;
  searchTimer = 0;
  searchPingTimer = 0;
  searchPingSpent = false;
  chaseSpeed = GLOAMFIN_CHASE_SPEED;

  // The Flarefish's own bookkeeping.
  flareTimer = FLARE_INTERVAL;
  flareActive = false;
  flarePhase = 0;
  flareCharging = false;
  flaring = false;
  flareRadius = 0;
  flareFade = 0;

  constructor(kind: PredatorKind, releaseAt: number | null) {
    this.kind = kind;
    this.releaseAt = releaseAt;
  }

  /**
   * Puts it back on a den tile, unreleased and with every timer of its own
   * armed afresh, which is where a maze laid out at any depth starts it.
   */
  returnToDen(cell: Cell): void {
    restAt(this, cell);
    this.facing = "up";
    this.speed = PREDATOR_SPEED;
    this.state = "den";
    this.released = false;
    this.dropFix();
    this.alert = 0;
    this.mark = 0;
    this.pingTimer = GLOAMFIN_PING_INTERVAL;
    this.pingGap = 0;
    this.chaseSpeed = GLOAMFIN_CHASE_SPEED;
    this.flareTimer = FLARE_INTERVAL;
    this.endFlare();
    this.flareFade = 0;
  }

  /** Drops whatever it believes about the forager. */
  dropFix(): void {
    this.fix = null;
    this.linger = 0;
    this.hearingLock = false;
    this.searchTimer = 0;
    this.searchPingTimer = 0;
    this.searchPingSpent = false;
  }

  /** Ends a flare, leaving the bloom's art to fade on its own. */
  endFlare(): void {
    this.flareActive = false;
    this.flarePhase = 0;
    this.flareCharging = false;
    this.flaring = false;
    this.flareRadius = 0;
  }
}

/**
 * The roster a depth holds (`specs/predators.md`), in release order: one of
 * each kind at depth `1`, one more per depth beyond it cycling
 * `ROSTER_ADD_ORDER`, and no more from `ROSTER_CAP_DEPTH` on.
 */
export function predatorRoster(depth: number): PredatorKind[] {
  const roster: PredatorKind[] = [...DEN_ORDER];
  const added = Math.min(Math.max(depth, 1), ROSTER_CAP_DEPTH) - 1;
  for (let i = 0; i < added; i++) {
    roster.push(ROSTER_ADD_ORDER[i % ROSTER_ADD_ORDER.length]);
  }
  return roster;
}

/** The roster of a depth, built into predators with their release times. */
export function buildRoster(depth: number): Predator[] {
  return predatorRoster(depth).map(
    (kind, slot) => new Predator(kind, slot * DEN_RELEASE_GAP),
  );
}

/**
 * The den tiles predators are parked on. A layout with a den of its own is
 * filled from the middle outward; a posed fixture falls back to whatever den
 * tiles it carries, and one with no den at all parks them on the forager's own
 * resting tile, where they are held out of play — a predator in the den is
 * neither drawn nor able to make contact.
 */
export function denSlots(maze: Maze): Cell[] {
  const preferred = DEN_SLOTS.filter((cell) => maze.isDen(cell.tx, cell.ty));
  if (preferred.length > 0) return [...preferred];
  if (maze.denTiles.length > 0) return [...maze.denTiles];
  return [maze.start];
}

/**
 * The wander every creature with no fix travels on: one of the open directions
 * out of the tile, drawn at random, preferring one other than an immediate
 * reverse whenever one is open. It is what a drifter does and what a
 * Lanternjaw that has not found the forager does, so the two are alike in
 * motion as well as in look.
 */
export function wanderIntent(
  body: Body,
  maze: Maze,
  rng: Rng,
  open: TileTest,
): Dir | null {
  const cell = bodyCell(body);
  const exits = maze.exits(cell.tx, cell.ty, open);
  if (exits.length === 0) return null;
  const back = body.heading === null ? null : opposite(body.heading);
  const onward = exits.filter((dir) => dir !== back);
  return rng.pick(onward.length > 0 ? onward : exits);
}
