// star-core/approach — the arrangements every check in this group drives a body
// into the star's core with. Local to this group.
//
// `specs/field.md` makes the core "the one physical boundary on the field" and
// `specs/collision.md` gives it a different answer for each body that reaches
// it: a shot is absorbed, a rock is recycled, the ship slides. Every item here
// therefore begins the same way — put one body on a course into the core, let
// the game's own swept collision decide the contact, and read what the core did
// with it — and that beginning is what lives in this file.
//
// NO THRESHOLD LIVES HERE. Every bound a check asserts is stated in the check
// itself and derived there from the figure `specs/` gives it. What is here is
// ARRANGEMENT — where a body starts, how fast it closes, which way it is
// pointing — plus the one guard that the pose landed.
//
// WHY A BODY IS AIMED RATHER THAN DROPPED. A body released near the star and
// left to fall would reach the core, but the well would decide when: the reading
// would then depend on `specs/gravity.md`'s law as much as on
// `specs/collision.md`'s rule, and a build whose pull is slightly off would fail
// a core item for a gravity fault. Every arrangement below closes under its own
// posed velocity, fast enough that the well's contribution over the approach is
// a small correction to a course the check chose. The well is still running —
// nothing is switched off — it simply is not what decides the contact.

import {
  CORE_R,
  FACE_UP,
  MU,
  SHIP_R,
  SOFTEN,
  STAR_X,
  STAR_Y,
  TICK_DT,
} from "../constants";
import { assertLessThanOrEqual, fail } from "../assert";
import { DEG, STAR, directDistance, sweptHit, type Vec } from "../geometry";
import {
  poseShip,
  type Harness,
  type RockSnapshot,
  type ShatterSnapshot,
  type ShipSnapshot,
} from "../harness";

/* -------------------------------------------------------------------------- */
/* Placing a body around the star                                             */
/* -------------------------------------------------------------------------- */

/**
 * The point exactly `distance` units from the star's centre along `bearing`.
 *
 * Bearings are measured the way `specs/overview.md` measures every angle in this
 * game: clockwise from `+x`, with `y` running down the field. The star stands at
 * the field's centre (`specs/field.md`) and every distance this group poses is a
 * few hundred units at most, so the point is well inside the field and its
 * separation from the star is the plain difference.
 */
export function aroundTheStar(distance: number, bearing: number): Vec {
  return {
    x: STAR_X + distance * Math.cos(bearing),
    y: STAR_Y + distance * Math.sin(bearing),
  };
}

/**
 * The velocity that carries a body at `from` straight at the star's centre at
 * `speed`.
 *
 * Dead-centre on purpose. `specs/gravity.md` pulls a round and a rock along the
 * direct vector to `(STAR_X, STAR_Y)`, which for a body already on that line is
 * the line it is travelling: the well speeds the body up and bends it nowhere,
 * so the course a check posed is the course the body keeps and the contact is
 * the one the check arranged.
 */
export function inwardFrom(
  from: Vec,
  speed: number,
): { vx: number; vy: number } {
  const dx = STAR_X - from.x;
  const dy = STAR_Y - from.y;
  const d = Math.hypot(dx, dy);
  return { vx: (speed * dx) / d, vy: (speed * dy) / d };
}

/** How far a body of `radius` is from touching the core, in units. */
export function coreClearance(at: Vec, radius: number): number {
  return directDistance(at, STAR) - (CORE_R + radius);
}

/**
 * How far a pose may land from where it was asked, in units and in units per
 * second.
 *
 * This is a GUARD, not a tolerance on any rule: it decides only whether the
 * surface put the body where the check asked for it, so that a build whose pose
 * did nothing fails naming the operation rather than reading a scenario that was
 * never arranged. Half a unit is far below any figure this group asserts and far
 * above the rounding a pose can honestly do.
 */
const POSE_SLACK = 0.5;

/* -------------------------------------------------------------------------- */
/* The ship's graze                                                           */
/* -------------------------------------------------------------------------- */
//
// The four ship items — the standoff, the tangential component kept, the inward
// component removed and the facing left alone — all read the SAME contact, each
// asserting a different one of `specs/collision.md`'s three numbered steps. One
// arrangement serves all four, so a build that fails two of them fails them on
// one event rather than on four scenarios that might not agree.

/** How far from the star's centre the ship's approach begins, in units. */
export const GRAZE_RANGE = 200;

/** The bearing it begins on. Off every axis and every diagonal, so no build
 * passes on a special case. */
export const GRAZE_BEARING = 150 * DEG;

/**
 * The speed it closes at, in units per second.
 *
 * A plain cruise: well under `SHIP_MAX` (`680`) and worth `2.5` units of travel
 * a tick, which is a fifth of `SHIP_R`. That matters. `specs/collision.md`
 * mandates a swept test, but a build that resolves the slide from the ship's
 * end-of-tick position instead is wrong about tunnelling and not about the
 * slide — and at this speed the ship spends twenty-odd ticks with its centre
 * inside `CORE_R + SHIP_R`, so both kinds of build meet the core and this group
 * grades the slide rather than the sweep. `bullets/no-tunnelling-at-speed` is
 * where a build owes the sweep.
 */
export const GRAZE_SPEED = 300;

/**
 * How far the ship's undeflected line would pass from the star's centre, in
 * units.
 *
 * OFF-CENTRE ON PURPOSE, and this figure is the whole reason the group can tell
 * three wrong models apart. At the contact the incoming velocity splits into a
 * component along the surface and one into it, and a straight line's angular
 * momentum fixes the split: at `CORE_R + SHIP_R` (`44`) from the centre the
 * component along the surface is `GRAZE_MISS / 44` of the speed, which at `30`
 * is a bit over two thirds of it. The approach takes a little over half a second
 * and `specs/ship.md`'s drag bleeds the `300` it was posed at down to about
 * `262` by then, so the contact splits into roughly `179` units per second along
 * the surface against `191` into it — two substantial and clearly different
 * numbers, so a build that keeps everything, a build that keeps nothing and a
 * build that reflects each read a different pair.
 *
 * It is also comfortably inside `44`, so the contact happens whatever the build
 * does about it; and comfortably outside `0`, so the contact normal is a real
 * direction rather than the degenerate one a dead-centre approach would make.
 */
export const GRAZE_MISS = 30;

/**
 * The facing the ship holds through the approach.
 *
 * `FACE_UP`, which is `-90` degrees — and deliberately not the heading it is
 * travelling on (`-21` degrees), not the contact normal (`116` degrees) and not
 * the surface tangent (`26` degrees). A build that swings the facing onto any of
 * those three at the contact is at least `69` degrees out, so
 * `ship-keeps-its-facing` reads a different number for each of them.
 */
export const GRAZE_FACING = FACE_UP;

/**
 * How many ticks the approach is driven for: `140`, a little over a second of
 * game time.
 *
 * Long enough that the contact — around tick `70` at this range and speed — is
 * well inside the drive whatever the well adds, and that the ship is seen
 * sliding free afterwards rather than stopping on the frame of the measurement.
 * No key is held over any of it, so nothing but the core touches the ship.
 */
export const GRAZE_FRAMES = 140;

/** The ship's approach, as the checks that read it see it. */
export interface Graze {
  /** Every post-tick reading of the ship, oldest first; index `0` is the pose. */
  readonly path: readonly ShipSnapshot[];
  /** Each reading's distance from the star's centre, in the same order. */
  readonly range: readonly number[];
  /**
   * The index of the reading CLOSEST to the star's centre, which is the tick the
   * contact resolved on.
   *
   * Read as the least range rather than by reconstructing when the ship's circle
   * met the core, because the least range is well defined for every build and
   * needs no epsilon. For a build that obeys `specs/collision.md` it IS the
   * contact tick: the resolution puts the ship at exactly `CORE_R + SHIP_R` from
   * the centre, and the velocity it is left with is tangent there, so every
   * later reading is further out and every earlier one was still closing. For a
   * build that does nothing at the core it is the ship's closest approach, which
   * is the same instant read on a build that failed to act on it.
   */
  readonly contact: number;
}

/**
 * The ship posed `GRAZE_RANGE` units out on a course that would pass
 * `GRAZE_MISS` from the star's centre, driven for `GRAZE_FRAMES` ticks, and
 * every reading it made on the way.
 *
 * The caller has already put the game into live play — `startPlaying`, or that
 * plus the one gate its own item is about. Nothing here touches a gate: the
 * slide is not gated (`specs/instrumentation.md` is explicit that
 * `setShipCollision` leaves the ship-and-core rule alone), so a check that wants
 * the lethal contact test on turns it on itself and a check that does not leaves
 * the harness default.
 *
 * The ship carries no thrust and holds no key, and `specs/gravity.md` never
 * pulls it, so between the pose and the contact the only thing acting on it is
 * `specs/ship.md`'s drag — which scales the velocity and turns it nowhere. The
 * course the check posed is therefore the course the ship arrives on.
 */
export async function grazeTheCore(h: Harness): Promise<Graze> {
  const posed = poseTheApproach(h);
  const path: ShipSnapshot[] = [posed];
  for (let frame = 0; frame < GRAZE_FRAMES; frame += 1) {
    await h.advance(1);
    path.push(h.snapshot().ship);
  }

  const range = path.map((ship) => directDistance(ship, STAR));
  let contact = 0;
  for (let i = 1; i < range.length; i += 1) {
    if (range[i] < range[contact]) contact = i;
  }

  return { path, range, contact };
}

/**
 * The ship put on the approach, and the reading it took there.
 *
 * The heading that misses the star's centre by `GRAZE_MISS` is straight at the
 * star swung out by the angle a line at that perpendicular distance subtends
 * from this range: `sin` of that angle is `GRAZE_MISS / GRAZE_RANGE` exactly.
 */
function poseTheApproach(h: Harness): ShipSnapshot {
  const from = aroundTheStar(GRAZE_RANGE, GRAZE_BEARING);
  const heading = GRAZE_BEARING + Math.PI + Math.asin(GRAZE_MISS / GRAZE_RANGE);
  const vx = GRAZE_SPEED * Math.cos(heading);
  const vy = GRAZE_SPEED * Math.sin(heading);

  poseShip(h, { x: from.x, y: from.y, vx, vy, angle: GRAZE_FACING });

  // The pose landed. A ship the surface left where it was would read a scenario
  // this check never arranged, so it is caught here, naming the operation.
  const posed = h.snapshot().ship;
  assertLessThanOrEqual(
    Math.hypot(posed.x - from.x, posed.y - from.y),
    POSE_SLACK,
    `setShipPosition(${from.x.toFixed(2)}, ${from.y.toFixed(2)}) to place the ` +
      "ship's centre there (specs/instrumentation.md); it reports " +
      `(${posed.x.toFixed(2)}, ${posed.y.toFixed(2)})`,
  );
  assertLessThanOrEqual(
    Math.hypot(posed.vx - vx, posed.vy - vy),
    POSE_SLACK,
    `setShipVelocity(${vx.toFixed(2)}, ${vy.toFixed(2)}) to set the ship's ` +
      "velocity (specs/instrumentation.md); it reports " +
      `(${posed.vx.toFixed(2)}, ${posed.vy.toFixed(2)})`,
  );

  return posed;
}

/**
 * Put the frame of the contact back on the canvas, for a check whose declared
 * output is a still of the ship ON the core.
 *
 * EVIDENCE ONLY, and it runs after every reading the verdict rests on has been
 * taken. `grazeTheCore` drives past the contact so the ship is seen sliding
 * free, which leaves the canvas holding a frame from a second later; this poses
 * the same approach again and stops on the tick the contact resolved, so the
 * picture a reviewer looks at is the moment the item is named for. The approach
 * is deterministic — a posed ship, no key held, an empty field and no draw of
 * the game's randomness anywhere in it — so the frame it stops on is the one the
 * reading was taken from.
 */
export async function showTheContact(h: Harness, graze: Graze): Promise<void> {
  poseTheApproach(h);
  await h.advance(graze.contact);
}

/**
 * The contact's outward normal: the unit vector from the star's centre to the
 * ship, at the reading the contact resolved on.
 *
 * `specs/collision.md` step 1 pushes the ship out "along the direction from the
 * star's centre to the ship", so this direction is the same before and after the
 * push and reading it off the post-tick position is reading the very direction
 * the resolution used. Steps 2's two components are taken against it.
 */
export function contactNormal(graze: Graze): Vec {
  const at = graze.path[graze.contact];
  const dx = at.x - STAR_X;
  const dy = at.y - STAR_Y;
  const d = Math.hypot(dx, dy);
  return { x: dx / d, y: dy / d };
}

/** The distance from the star's centre at which the ship rests on the core. */
export const SURFACE = CORE_R + SHIP_R;

/* -------------------------------------------------------------------------- */
/* A body slung straight into the core                                        */
/* -------------------------------------------------------------------------- */
//
// The three items about what the core does to a body that is NOT the ship — it
// absorbs a shot, it absorbs a saucer's shot, it takes a rock — each pose one
// body dead on the star's centre and drive it in. Only the rock's needs to know
// WHICH TICK the contact fell on, so only the rock's is arranged here.

/** The field's one rock, failing when the scenario no longer has exactly one. */
export function theOneRock(
  snapshot: ShatterSnapshot,
  scenario: string,
): RockSnapshot {
  const rock = snapshot.rocks[0];
  if (rock === undefined || snapshot.rocks.length !== 1) {
    fail(
      `${scenario}: exactly one rock on the field`,
      `the rock roster holds ${snapshot.rocks.length} rocks`,
    );
  }
  return rock;
}

/**
 * How much faster than its last reading a falling body could be travelling by
 * the end of the coming tick, in units per second.
 *
 * `specs/gravity.md` caps the pull at `MU / (SOFTEN * SOFTEN)`, so one tick of
 * it adds at most this to the speed of a body falling straight down the well —
 * which is what every body this section poses is doing, since each is aimed at
 * `(STAR_X, STAR_Y)` and the pull is along that same line.
 */
const ONE_TICK_OF_PULL = (MU / (SOFTEN * SOFTEN)) * TICK_DT;

/** What the drive found: the rock on its way in, and the field after the take. */
export interface Take {
  /** The rock's last reading before the tick that carried it into the core. */
  readonly approaching: RockSnapshot;
  /** Ticks run before that reading. */
  readonly ticks: number;
  /** The field two ticks later: the tick of the contact, and the tick after it. */
  readonly after: ShatterSnapshot;
}

/**
 * Drive the field's one rock into the core and read the field back the tick
 * after its circle reached it.
 *
 * WHICH TICK THE CONTACT FALLS ON IS WORKED OUT FROM THE ROCK'S OWN READINGS,
 * not from what the build did with it. The check cannot watch for the resolution
 * — `specs/simulation.md` resolves collision inside the tick, so by the time a
 * snapshot can be taken the rock has already been dealt with — so each tick the
 * rock's coming tick is put through `specs/collision.md`'s own swept test
 * against the core, and the first tick that test says contains the contact is
 * the contact.
 *
 * THE RECONSTRUCTION IS DELIBERATELY EAGER. It is run from the rock's last
 * post-tick velocity, while the build resolves the tick with the velocity the
 * well has already added to over it — a difference of at most
 * {@link ONE_TICK_OF_PULL}, all of it in the direction of travel. Left alone
 * that would let a build resolve the contact one tick before this test noticed
 * it, and the rock would then be read long after it was re-placed. Adding that
 * one tick of pull to the reconstruction makes it fire no later than the build
 * does; firing a tick EARLY costs nothing, because the reading is taken two
 * ticks on, which is the item's "the tick after its circle reaches it" with a
 * tick of slack.
 */
export async function driveTheRockIn(
  h: Harness,
  budget: number,
): Promise<Take> {
  const core = { x: STAR_X, y: STAR_Y, vx: 0, vy: 0 };

  for (let ticks = 0; ticks < budget; ticks += 1) {
    const approaching = theOneRock(
      h.snapshot(),
      "the rock on its way into the core",
    );
    const speed = Math.hypot(approaching.vx, approaching.vy);
    const eager = 1 + ONE_TICK_OF_PULL / speed;
    const reaching = sweptHit(
      {
        x: approaching.x,
        y: approaching.y,
        vx: approaching.vx * eager,
        vy: approaching.vy * eager,
      },
      core,
      CORE_R + approaching.radius,
    );
    if (reaching) {
      // The tick the contact falls in, and the tick after it.
      await h.advance(2);
      return { approaching, ticks, after: h.snapshot() };
    }
    await h.advance(1);
  }

  const stalled = theOneRock(h.snapshot(), "the rock that never arrived");
  return fail(
    "a rock aimed at the star's centre reaching the core inside " +
      `${budget} ticks (specs/gravity.md, specs/collision.md)`,
    `${budget} ticks on it is still ` +
      `${coreClearance(stalled, stalled.radius).toFixed(1)} units from ` +
      "touching the core",
  );
}
