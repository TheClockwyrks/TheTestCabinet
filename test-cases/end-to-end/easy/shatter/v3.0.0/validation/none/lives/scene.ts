// lives — the one death this group is arranged around, and the readings that
// follow it.
//
// LOCAL TO THIS GROUP ON PURPOSE. `validation/none/harness.ts` owns the compound
// sequences the whole project shares; what is here is wanted only by the sixteen
// `lives` checks, so it lives beside them rather than widening the shared file.
//
// WHAT EVERY CHECK IN THE GROUP HAS IN COMMON. `specs/collision.md` gives the ship
// exactly three lethal contacts — a rock, the saucer, and a saucer bullet — and
// `specs/progression.md` says losing a ship costs one life and, with lives left,
// puts the next up at the safe point. So each check here opens the ship's contact
// gate (the gate IS its requirement), clears the respawn grace, and lets the
// build's own collision pass resolve a real approach. Nothing is overlapped onto
// the ship by the pose: the pair starts apart and closes.

import { fail } from "../assert";
import { FACE_UP, ROCK_RADIUS, SAFE_X, SAFE_Y, SHIP_R } from "../constants";
import { magnitude, wrappedDistance, type Vec } from "../geometry";
import {
  poseRock,
  secondsFor,
  ticksFor,
  type Harness,
  type ShatterSnapshot,
  type UntilResult,
} from "../harness";

/**
 * Where every lethal contact in this group is arranged, in logical field units.
 *
 * Down in the field's bottom-left, `511` units from `(STAR_X, STAR_Y)`, where the
 * well pulls at some `17` units per second squared (`specs/gravity.md`) — a fifth
 * of a unit over the third of a second an approach here takes, against contact
 * circles tens of units across, so nothing any check reads is the environment's
 * doing. The ship is never pulled at all (`specs/ship.md`), so it stays exactly
 * where it is posed.
 *
 * AND IT IS `444` UNITS FROM THE SAFE POINT, which is what makes the three respawn
 * items decidable: a build that leaves its wreck where it died reads a position
 * nowhere near `(SAFE_X, SAFE_Y)`, so "the next ship appears at the safe point" is
 * not satisfied by a ship that never moved. Every edge is more than the pair's
 * radii away, so nothing here wraps.
 */
export const DEATH_SPOT: Vec = { x: 200, y: 620 };

/**
 * Where a rock the two extra-ship checks shoot down is posed.
 *
 * On a quiet part of the field `428` units from the star's centre — outside
 * everything the star draws (`specs/field.md`), far enough that the well moves a
 * resting Small a fraction of a unit over the tenth of a second a round spends
 * crossing its standoff, and `344` units from the safe point the ship stands at, so
 * neither the shot nor the kill goes anywhere near the ship.
 */
export const KILL_SPOT: Vec = { x: 300, y: 620 };

/** The safe point a life begins at (`specs/ship.md`, `specs/progression.md`). */
export const SAFE_POINT: Vec = { x: SAFE_X, y: SAFE_Y };

/** The separation at which the ship and a Small touch (`specs/collision.md`). */
export const SHIP_TOUCHES_SMALL = SHIP_R + ROCK_RADIUS.small;

/**
 * How far above the ship a closing rock is posed, centre to centre.
 *
 * Seventy-two units of approach past the `28` at which the pair touches: long
 * enough that the contact is a real closing rather than an overlap the pose made,
 * short enough that the well has moved the rock a fraction of a unit by the time
 * it lands.
 */
export const APPROACH_GAP = 100;

/**
 * The speed a closing rock is set drifting at, in units per second.
 *
 * Inside the `130` to `210` a Small's own drift runs at (`specs/rocks.md`), so the
 * rock moves no faster than the game itself sets one moving, and the approach is a
 * third of a second rather than a stretch the well can bend.
 */
export const ROCK_DRIFT = 200;

/**
 * How long a contact this group arranges is watched for, in ticks.
 *
 * The longest approach any check here poses is `(APPROACH_GAP - 28) / ROCK_DRIFT`,
 * a third of a second, so a whole second is three times over: a build whose swept
 * contact lands a tick or two late still reaches its verdict rather than timing
 * out, and a build that never resolves the contact fails with the scenario named
 * rather than hanging the suite.
 */
export const LOSS_TICKS = ticksFor(1);

/**
 * How long the build is given to put the next ship up, in ticks.
 *
 * NOT A FIGURE THE SPECIFICATION FIXES, AND DELIBERATELY GENEROUS.
 * `specs/progression.md` names no pause at all between a ship being lost and the
 * next appearing — "when a ship is lost and lives remain, the next ship appears at
 * rest at the safe point" — so a build that puts the next ship up on the tick of
 * the loss and a build that plays a beat of destruction first are both conformant,
 * and this is the allowance that lets either be read. A second of game time is
 * many times the beat any arcade game holds; a build that has put no ship up
 * inside it has not put one up.
 *
 * Reading LATE costs the three respawn items nothing: the next ship is at rest at
 * the safe point with no thrust held, the well never pulls it, and the field it
 * stands on has been emptied — so the pose a check reads after this is the pose
 * the respawn produced.
 */
export const RESPAWN_SETTLE = ticksFor(1);

/** How a doomed ship and the rock closing on it are posed. */
export interface DoomedShip {
  /** Where the ship stands. Defaults to {@link DEATH_SPOT}. */
  at?: Vec;
  /** The speed the ship itself carries INTO the contact, up the field. Default `0`. */
  shipSpeed?: number;
  /** The ship's facing, in radians. Defaults to `FACE_UP`. */
  angle?: number;
  /** The rock's own closing drift. Defaults to {@link ROCK_DRIFT}. */
  rockDrift?: number;
  /** How far above the ship the rock is posed. Defaults to {@link APPROACH_GAP}. */
  gap?: number;
  /** The seconds of respawn grace the ship is posed with. Defaults to `0`. */
  grace?: number;
}

/** How closely a pose must read back before the scenario it arranges is real. */
const POSE_READBACK = {
  /** Logical units. A pose that landed reads back exactly; this is float slack. */
  position: 0.5,
  /** Units per second, on the same terms. */
  speed: 0.5,
  /** Radians: a hundredth of one, some `0.57` degrees. */
  angle: 0.01,
} as const;

/**
 * Pose a ship the next tick or two will destroy, and hand back the id of the rock
 * that will do it.
 *
 * The ship is placed at rest (or carrying `shipSpeed` up the field), facing where
 * the caller asked, with its respawn grace posed and ITS LETHAL CONTACT TEST TURNED
 * BACK ON — which is the one gate this whole group turns on, because the contact
 * test is its requirement (`specs/instrumentation.md`). A Small is then posed
 * `gap` units above it, closing at `rockDrift`, so the pair converges along the
 * vertical at `shipSpeed + rockDrift` and the build's own collision pass resolves
 * a real approach.
 *
 * THE POSE IS READ BACK BEFORE THE SCENARIO RUNS. A build that quietly ignores
 * `setShipPosition` would leave the ship sitting at the safe point, where "the next
 * ship appears at the safe point" is true of a ship that never moved; one that
 * ignored `setShipVelocity` would leave "the next ship appears at rest" true of a
 * ship that was never moving. Each of those is a check passing on a scenario that
 * never existed, so the pose is confirmed here and named when it is missing.
 * `instrumentation/poses-read-back` is the item that GRADES the poses; this only
 * refuses to grade a requirement against a world that was never arranged.
 */
export async function arrangeDoomedShip(
  h: Harness,
  spec: DoomedShip = {},
): Promise<number> {
  const at = spec.at ?? DEATH_SPOT;
  const shipSpeed = spec.shipSpeed ?? 0;
  const angle = spec.angle ?? FACE_UP;
  const drift = spec.rockDrift ?? ROCK_DRIFT;
  const gap = spec.gap ?? APPROACH_GAP;
  const grace = spec.grace ?? 0;

  await h.debug.setShipPosition(at.x, at.y);
  await h.debug.setShipVelocity(0, -shipSpeed);
  await h.debug.setShipAngle(angle);
  await h.debug.setShipInvuln(grace);
  await h.debug.setShipCollision(true);
  const rockId = await poseRock(h, "small", at.x, at.y - gap, 0, drift);

  const posed = await h.snapshot();
  requirePose(
    wrappedDistance({ x: posed.ship.x, y: posed.ship.y }, at),
    POSE_READBACK.position,
    `a ship standing at (${at.x}, ${at.y}), ${Math.round(wrappedDistance(at, SAFE_POINT))} units from the safe point`,
    `the build reported it at (${posed.ship.x}, ${posed.ship.y})`,
  );
  requirePose(
    Math.abs(magnitude({ x: posed.ship.vx, y: posed.ship.vy }) - shipSpeed),
    POSE_READBACK.speed,
    `a ship carrying ${shipSpeed} units per second into the contact`,
    `the build reported a speed of ${posed.ship.speed}`,
  );
  requirePose(
    Math.abs(normalizedDifference(posed.ship.angle, angle)),
    POSE_READBACK.angle,
    `a ship facing ${angle.toFixed(4)} radians`,
    `the build reported a facing of ${posed.ship.angle}`,
  );
  return rockId;
}

/** The short-way difference between two facings, in radians. */
function normalizedDifference(from: number, to: number): number {
  return Math.atan2(Math.sin(from - to), Math.cos(from - to));
}

/** Refuse to grade a requirement against a world the build never arranged. */
function requirePose(
  off: number,
  allowed: number,
  wanted: string,
  found: string,
): void {
  if (!(off <= allowed)) {
    fail(`${wanted} (specs/instrumentation.md)`, found);
  }
}

/**
 * Run the real simulation until the life count falls below `before`, sampling every
 * tick, and report where the game stood on the tick it fell.
 *
 * Every tick, because what several of these read is the state the loss LEFT: the
 * counter it reached, the ship it put up, the grace that ship opened with.
 */
export function untilLifeLost(
  h: Harness,
  before: number,
  maxTicks = LOSS_TICKS,
): Promise<UntilResult> {
  return h.until((snapshot) => snapshot.lives < before, { maxTicks, poll: 1 });
}

/**
 * Run until the life count has fallen AND a ship is carrying respawn grace, and
 * report the tick both first held.
 *
 * The moment `specs/progression.md` calls the next ship appearing, read without
 * looking at where that ship stands: the grace is the thing the respawn brings that
 * the ship that died did not have (every check here poses `invuln` to `0` first),
 * so a check on the grace's own opening value can find the respawn without
 * assuming anything about the position, the velocity or the facing that the other
 * items in this group decide.
 */
export function untilGraceOpens(
  h: Harness,
  before: number,
  maxTicks = LOSS_TICKS + RESPAWN_SETTLE,
): Promise<UntilResult> {
  return h.until(
    (snapshot) => snapshot.lives < before && snapshot.ship.invuln > 0,
    { maxTicks, poll: 1 },
  );
}

/**
 * Take the rock that killed the ship off the field and give the build its
 * {@link RESPAWN_SETTLE} to put the next ship up, then read the state.
 *
 * The rock goes through `clearRocks`, which "destroys nothing and scores nothing"
 * (`specs/instrumentation.md`), so the field is left empty without a wave being
 * cleared and without a point being paid — the pose is a removal, not a kill.
 */
export async function settleRespawn(h: Harness): Promise<ShatterSnapshot> {
  await h.debug.clearRocks();
  await h.advance(RESPAWN_SETTLE);
  return h.snapshot();
}

/**
 * What a contact that never landed needed, named for the check that grades it.
 *
 * The `Expected:` line of a build that let the body through: what closed on the
 * ship, how far outside touching distance it started, how fast it closed, and how
 * long it was watched for.
 */
export function contactNeeded(
  what: string,
  gap: number,
  touching: number,
  closing: number,
): string {
  return (
    `the ship destroyed and a life lost inside ${secondsFor(LOSS_TICKS).toFixed(1)} s ` +
    `of game time, its contact gate open and its grace clear, by ${what} closing ` +
    `the ${(gap - touching).toFixed(0)} units from ${gap} down to the ${touching} at ` +
    `which the pair touches, at ${closing} units per second ` +
    `(specs/collision.md, specs/progression.md)`
  );
}
