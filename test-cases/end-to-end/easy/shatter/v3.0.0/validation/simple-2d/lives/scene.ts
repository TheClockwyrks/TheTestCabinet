// lives — the one death this group is arranged around, and the readings that
// follow it.
//
// LOCAL TO THIS GROUP ON PURPOSE. `validation/simple-2d/harness.ts` owns the
// compound sequences the whole project shares; what is here is wanted only by the
// sixteen `lives` checks, so it lives beside them rather than widening the shared
// file every other group agent is also editing.
//
// WHAT EVERY CHECK IN THE GROUP HAS IN COMMON. `specs/collision.md` gives the ship
// exactly three lethal contacts — a rock, the saucer, and a saucer bullet — and
// `specs/progression.md` says losing a ship costs one life and, with lives left,
// puts the next up at the safe point. So each check here opens the ship's contact
// gate (the gate IS its requirement), clears the respawn grace, and lets the
// build's own collision pass resolve a real approach. Nothing is overlapped onto
// the ship by the pose: the pair starts apart and closes.
//
// AND NOTHING HERE FIXES A THRESHOLD. Harness rule 2 holds for a group-local file
// too: what is below says where a body was put, how long it was watched, and where
// a colour was read — every bound a check asserts is stated in that check, next to
// the figure `specs/` fixes for it. The one exception is {@link POSE_READBACK},
// which is not a bound on the BUILD's behaviour at all: it is how closely a pose
// must have landed before this file will let a requirement be graded against the
// world it arranged.

import { fail } from "../assert";
import { FACE_UP, ROCK_RADIUS, SAFE_X, SAFE_Y, SHIP_R } from "../constants";
import { angleGap, distance, wrap, type Point } from "../geometry";
import {
  colorDistance,
  poseRock,
  sample,
  secondsFor,
  speedOf,
  ticksFor,
  type Harness,
  type Rgb,
  type UntilResult,
} from "../harness";
import type { ShatterSnapshot } from "../surface";

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
export const DEATH_SPOT: Point = { x: 200, y: 620 };

/**
 * Where a rock the two extra-ship checks shoot down is posed.
 *
 * On a quiet part of the field `428` units from the star's centre — outside
 * everything the star draws (`specs/field.md`), far enough that the well moves a
 * resting Small a fraction of a unit over the tenth of a second a round spends
 * crossing its standoff, and `344` units from the safe point the ship stands at,
 * so neither the shot nor the kill goes anywhere near the ship.
 */
export const KILL_SPOT: Point = { x: 300, y: 620 };

/** The safe point a life begins at (`specs/ship.md`, `specs/progression.md`). */
export const SAFE_POINT: Point = { x: SAFE_X, y: SAFE_Y };

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

/** The centre of anything a snapshot reports as an `x` and a `y`. */
export function centreOf(body: { x: number; y: number }): Point {
  return { x: body.x, y: body.y };
}

/** How a doomed ship and the rock closing on it are posed. */
export interface DoomedShip {
  /** Where the ship stands. Defaults to {@link DEATH_SPOT}. */
  at?: Point;
  /** The speed the ship carries INTO the contact, up the field. Default `0`. */
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
 * the caller asked, with its respawn grace posed and ITS LETHAL CONTACT TEST
 * TURNED BACK ON — which is the one gate this whole group turns on, because the
 * contact test is its requirement (`specs/instrumentation.md`). A Small is then
 * posed `gap` units above it, closing at `rockDrift`, so the pair converges along
 * the vertical at `shipSpeed + rockDrift` and the build's own collision pass
 * resolves a real approach.
 *
 * THE POSE IS READ BACK BEFORE THE SCENARIO RUNS. A build that quietly ignored
 * `setShipPosition` would leave the ship sitting at the safe point, where "the
 * next ship appears at the safe point" is true of a ship that never moved; one
 * that ignored `setShipVelocity` would leave "the next ship appears at rest" true
 * of a ship that was never moving. Each of those is a check passing on a scenario
 * that never existed, so the pose is confirmed here and named when it is missing.
 * `instrumentation/poses-read-back` is the item that GRADES the poses; this only
 * refuses to grade a requirement against a world that was never arranged.
 */
export function arrangeDoomedShip(h: Harness, spec: DoomedShip = {}): number {
  const at = spec.at ?? DEATH_SPOT;
  const shipSpeed = spec.shipSpeed ?? 0;
  const angle = spec.angle ?? FACE_UP;
  const drift = spec.rockDrift ?? ROCK_DRIFT;
  const gap = spec.gap ?? APPROACH_GAP;
  const grace = spec.grace ?? 0;

  h.debug.setShipPosition(at.x, at.y);
  h.debug.setShipVelocity(0, -shipSpeed);
  h.debug.setShipAngle(angle);
  h.debug.setShipInvuln(grace);
  h.debug.setShipCollision(true);
  const rockId = poseRock(h, "small", at.x, at.y - gap, 0, drift);

  const posed = h.snapshot();
  requirePose(
    distance(centreOf(posed.ship), at),
    POSE_READBACK.position,
    `a ship standing at (${at.x}, ${at.y}), ${Math.round(distance(at, SAFE_POINT))} units from the safe point`,
    `the build reported it at (${posed.ship.x}, ${posed.ship.y})`,
  );
  requirePose(
    Math.abs(speedOf(posed.ship) - shipSpeed),
    POSE_READBACK.speed,
    `a ship carrying ${shipSpeed} units per second into the contact`,
    `the build reported a speed of ${posed.ship.speed}`,
  );
  requirePose(
    angleGap(posed.ship.angle, angle),
    POSE_READBACK.angle,
    `a ship facing ${angle.toFixed(4)} radians`,
    `the build reported a facing of ${posed.ship.angle}`,
  );
  return rockId;
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
 * Run the real simulation until the life count falls below `before`, sampling
 * every tick, and report where the game stood on the tick it fell.
 *
 * Every tick, because what several of these read is the state the loss LEFT: the
 * counter it reached, the ship it put up, the grace that ship opened with.
 */
export function untilLifeLost(
  h: Harness,
  before: number,
  maxFrames = LOSS_TICKS,
): Promise<UntilResult> {
  return h.until((snapshot) => snapshot.lives < before, { maxFrames, poll: 1 });
}

/**
 * Run until the life count has fallen AND a ship is carrying respawn grace, and
 * report the tick both first held.
 *
 * The moment `specs/progression.md` calls the next ship appearing, read without
 * looking at where that ship stands: the grace is the thing the respawn brings
 * that the ship that died did not have (every check here poses `invuln` to `0`
 * first), so a check on the grace's own opening value can find the respawn without
 * assuming anything about the position, the velocity or the facing that the other
 * items in this group decide.
 */
export function untilGraceOpens(
  h: Harness,
  before: number,
  maxFrames = LOSS_TICKS + RESPAWN_SETTLE,
): Promise<UntilResult> {
  return h.until(
    (snapshot) => snapshot.lives < before && snapshot.ship.invuln > 0,
    { maxFrames, poll: 1 },
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
  h.debug.clearRocks();
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

/* ---- Reading the safe point off the canvas -------------------------------- */
//
// Wanted by `respawn-only-with-lives-left` alone, whose claim is that NOTHING is
// at the safe point once the last ship is lost — and "nothing" is both a reported
// position and a picture. What is fixed here is only WHERE the two readings are
// taken; how far apart two colours have to be to be different things is that
// check's own figure.

/**
 * Points a field posed by `startPlaying` leaves bare: on the field, clear of the
 * star's whole drawn extent (nothing of it is drawn beyond `1.5 x HALO_R`,
 * `specs/field.md`), clear of the safe point the ship stands at, clear of the
 * upper portion the HUD is drawn in, and spread across the field so no one
 * readout, banner or watermark a build chose to place can cover them all.
 */
export const BARE_POINTS: readonly Point[] = [
  { x: 110, y: 430 },
  { x: 1170, y: 430 },
  { x: 110, y: 660 },
  { x: 1170, y: 660 },
  { x: 400, y: 690 },
];

/** A colour's luminance, out of 255, on the usual Rec. 709 weighting. */
export function luminance(c: Rgb): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/**
 * The bare field's colour: the darkest of {@link BARE_POINTS}, sampled off the
 * frame currently on the canvas.
 *
 * The darkest of several rather than one fixed patch, because `specs/overview.md`
 * makes the field dark and everything on it brighter, but leaves a build free to
 * put a banner, a hint or a watermark anywhere it likes — and a patch something is
 * drawn over reads lighter than one nothing is.
 */
export function sampleBareField(h: Harness): Rgb {
  let darkest = sample(h, BARE_POINTS[0].x, BARE_POINTS[0].y);
  for (const point of BARE_POINTS.slice(1)) {
    const here = sample(h, point.x, point.y);
    if (luminance(here) < luminance(darkest)) darkest = here;
  }
  return darkest;
}

/** How far out from the safe point the patch reaches: rings of samples. */
const PATCH_RINGS = 9;

/** Samples around each ring of the patch. */
const PATCH_SPOKES = 16;

/**
 * How far the patch reaches from the safe point, in logical units.
 *
 * `SHIP_R + 2`, so the disc covers a ship drawn as its collision circle and the
 * outline of one drawn as the `34`-by-`26` triangle `specs/ship.md` describes —
 * a build that only STROKES its hull is read as surely as one that fills it.
 * It stops two units short of `20`, which is where the safe point's `200` from
 * the star's centre would bring a sample inside the `180` beyond which nothing of
 * the star is drawn (`specs/field.md`), so the star can never light the patch.
 */
const PATCH_RADIUS = SHIP_R + 2;

/** How many readings one patch is. */
export const PATCH_SAMPLES = PATCH_RINGS * PATCH_SPOKES;

/** The points the patch at the safe point is read at, centre outward. */
export function patchPoints(): Point[] {
  const points: Point[] = [];
  for (let ring = 0; ring < PATCH_RINGS; ring += 1) {
    const radius = (PATCH_RADIUS * ring) / (PATCH_RINGS - 1);
    for (let spoke = 0; spoke < PATCH_SPOKES; spoke += 1) {
      const theta = (Math.PI * 2 * (spoke + 0.5 * ring)) / PATCH_SPOKES;
      points.push(
        wrap({
          x: SAFE_X + radius * Math.cos(theta),
          y: SAFE_Y + radius * Math.sin(theta),
        }),
      );
      if (radius === 0) break;
    }
  }
  return points;
}

/**
 * The furthest any sample of the patch at the safe point stands from `bare`.
 *
 * The FURTHEST rather than a mean, because a ship drawn as an outline paints only
 * a few of the samples: a mean would let a wireframe ship read as bare field.
 */
export function patchDeparture(h: Harness, bare: Rgb): number {
  let worst = 0;
  for (const point of patchPoints()) {
    worst = Math.max(worst, colorDistance(sample(h, point.x, point.y), bare));
  }
  return worst;
}
