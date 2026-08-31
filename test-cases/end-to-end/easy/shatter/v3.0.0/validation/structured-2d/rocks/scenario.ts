// Shatter — the placements and the compounds the `rocks` checks share.
// CASE-PROVIDED.
//
// This group decides `specs/rocks.md`: what a rock is (a circle of its size's
// radius, drifting at its size's speed), what a destroyed one leaves behind
// (`specs/collision.md`'s fan), and what the star does with one it swallows. Three
// shapes recur across the twenty-one checks — a rock posed on quiet ground, a round
// placed on its doorstep and followed to the tick its hit lands, and a rock slung
// into the star and read on the tick it re-entered — so each is built once, here,
// rather than twenty-one times over in checks that would drift apart.
//
// IT LIVES IN THE GROUP RATHER THAN IN `../harness.ts` because nothing outside
// `rocks` poses them in this shape. The harness owns what the whole project
// shares — `aimedRound`, `poseRock`, `poseBullet`, `startPlaying`,
// `shootFieldDown` — and its `aimedRound` places a round that CARRIES ITS TARGET'S
// VELOCITY, which is exactly right for a sweep that only has to land a hit and
// exactly wrong for the two fan items, whose whole reading is the direction the
// BULLET was travelling in when it landed. What is below is the shot geometry those
// items need, and the recycling drive the five `recycle-*` items and two of the
// `drift-speed-*` items share.
//
// IT NEVER TOUCHES A `warhead`-ONLY OPERATION OR FIELD. Every item in this group is
// declared in `test-case.toml` rather than in `variants/warhead.toml`, so every
// check here loads against a `base` build as well as a `warhead` one: nothing below
// reads `rocks[].health` or reaches for `setRockHealth`, and every scenario that
// destroys a rock does it by placing rounds until the rock is GONE — one under
// `base`, up to `ROCK_HEALTH.large` (3) under `warhead` — rather than by assuming a
// number of hits it cannot import.
//
// NOT ONE FIGURE BELOW IS A BOUND. Everything here is geometry and patience — a
// position, a heading, a standoff, how long one round is followed, how big a jump
// can only be a re-placement — and every tolerance stays in the check that asserts
// it, derived there from the figure `specs/` fixes for it.

import {
  BULLET_R,
  FIELD_H,
  FIELD_W,
  MUZZLE_SPEED,
  ROCK_RADIUS,
  STAR_X,
  STAR_Y,
} from "../../src/constants";
import { fail } from "../assert";
import { QUIET_CORNER } from "../fixtures";
import {
  STAR,
  directDistance,
  shortestSeparation,
  wrapPoint,
  wrappedDistance,
  type Vec,
} from "../geometry";
import {
  ROUND_STANDOFF,
  bulletById,
  poseBullet,
  poseRock,
  requireRock,
  rockById,
  ticksFor,
  type Harness,
  type RockSize,
  type RockSnapshot,
  type ShatterSnapshot,
} from "../harness";

/* -------------------------------------------------------------------------- */
/* Quiet ground                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Where every scenario in this group that reads a posed quantity stands its rock:
 * the harness's own quiet corner, `(320, 620)`.
 *
 * `412` units from the star, where `specs/gravity.md`'s well pulls at about `26`
 * units per second squared — so over the tenth of a second a round spends crossing
 * its standoff the well adds a quarter of a unit per second to whatever the check
 * arranged. That is the whole reason the fan items stand out here: fold-in fix C of
 * `changelog.md` was a scenario posed where the well had moved the velocity it
 * read substantially over the shots, so the item measured a drift gravity had
 * built rather than the one it arranged.
 *
 * It is also clear of the star's whole drawn extent (nothing of the star is drawn
 * beyond `180`, `specs/field.md`), clear of the ship's safe point at `(640, 560)`,
 * and a Large's whole circle is inside the field, so nothing a still shows
 * straddles a seam.
 */
export const ROCK_GROUND: Vec = QUIET_CORNER;

/* -------------------------------------------------------------------------- */
/* Placing a round                                                            */
/* -------------------------------------------------------------------------- */

/** A round ready to be handed to `addBullet`: a centre and a velocity. */
export interface Aim {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * Where a round's centre starts, measured from its target's centre: contact — the
 * sum of the two radii, which is what `specs/collision.md` makes a touch — plus the
 * harness's own `ROUND_STANDOFF`, so the round begins clear of the rock's surface
 * and the build's own swept pass is what resolves the hit rather than an overlap
 * the pose created.
 */
export function roundReach(radius: number): number {
  return radius + BULLET_R + ROUND_STANDOFF;
}

/** The heading from a body toward the star's centre. */
export function inwardHeading(from: Vec): number {
  const dx = STAR_X - from.x;
  const dy = STAR_Y - from.y;
  // A body standing exactly on the star has no bearing to it. Nothing in this
  // group poses one there — the core takes a rock well outside it — so `+x` is as
  // good a direction as any.
  if (dx === 0 && dy === 0) return 0;
  return Math.atan2(dy, dx);
}

/** How a round is placed on a rock's doorstep. */
export interface AimOptions {
  /**
   * How far the round's line passes from the target's CENTRE, measured
   * perpendicular to `heading`. `0` is dead through the centre.
   */
  offset?: number;
  /**
   * Whether the round carries the target's own velocity.
   *
   * ON by default, which holds the `offset` above exactly constant in the rock's
   * own frame: the relative motion is then purely along `heading`, so a check that
   * poses a round to pass a stated distance from a drifting rock's centre poses
   * exactly that distance. OFF for the two fan items, whose reading is the
   * direction the BULLET was travelling in when it landed
   * (`specs/collision.md`): a round carrying its target's drift travels along the
   * SUM of the two, so a check that fired one and then measured a perpendicular
   * to `heading` would be measuring a line the bullet never took.
   */
  carry?: boolean;
  /** The speed the round closes at. Defaults to the gun's `MUZZLE_SPEED`. */
  speed?: number;
}

/**
 * A round placed `roundReach` back along `heading` from `target`, displaced
 * `offset` perpendicular to it, and travelling along `heading`.
 *
 * The caller chooses `heading`, and every caller in this group chooses it so that
 * the star is never on the round's way in: `specs/collision.md` has the core absorb
 * a shot that reaches it, so a round fired across the field's centre could vanish
 * into the star and the check would read a shot that was never spent on the rock.
 * {@link inwardHeading} is the general answer — the round then starts on the side
 * facing AWAY from the star and travels inward, so its whole flight is the
 * standoff — and the fan items instead fire along a row `260` units clear of the
 * star's own.
 */
export function roundAlong(
  target: { x: number; y: number; vx: number; vy: number; radius: number },
  heading: number,
  options: AimOptions = {},
): Aim {
  const offset = options.offset ?? 0;
  const carry = options.carry ?? true;
  const speed = options.speed ?? MUZZLE_SPEED;

  const along = { x: Math.cos(heading), y: Math.sin(heading) };
  const across = { x: -along.y, y: along.x };
  const reach = roundReach(target.radius);

  const placed = wrapPoint({
    x: target.x - along.x * reach + across.x * offset,
    y: target.y - along.y * reach + across.y * offset,
  });
  return {
    x: placed.x,
    y: placed.y,
    vx: (carry ? target.vx : 0) + along.x * speed,
    vy: (carry ? target.vy : 0) + along.y * speed,
  };
}

/** A round fired dead through a rock's centre from the side facing away from the star. */
export function headOn(target: RockSnapshot): Aim {
  return roundAlong(target, inwardHeading(target));
}

/* -------------------------------------------------------------------------- */
/* One round, followed to the tick it is spent                                */
/* -------------------------------------------------------------------------- */

/**
 * The most ticks one round is given before the sweep stops watching it.
 *
 * A round is placed `ROUND_STANDOFF` (`4`) units off its target's surface closing
 * at `MUZZLE_SPEED` (`520` — `specs/weapons.md`), which is under a tick of travel,
 * and `specs/collision.md` makes collision swept so the contact cannot be stepped
 * over. A quarter of a second is that with two orders of room, and it is also the
 * window a round that MISSES is watched over: `520` units per second carries it
 * `130` units in it, which is past a Large's whole circle and out the other side,
 * so a miss is a fact by the time the window closes rather than a round still on
 * its way.
 */
export const ROUND_WINDOW_TICKS = ticksFor(0.25);

/** What one round came to. */
export interface Shot {
  /** The id of the round that was placed. */
  bullet: number;
  /** The round left the bullet roster inside the window: it landed, or was absorbed. */
  spent: boolean;
  /** The rock it was aimed at left the roster inside the window. */
  destroyed: boolean;
  /**
   * The state on the last tick before the sweep stopped.
   *
   * What a check reads the parent's velocity off, so nothing the well did to the
   * parent enters a figure the split wrote.
   */
  before: ShatterSnapshot;
  /** The state the sweep stopped on: the tick of the kill, or the window's end. */
  at: ShatterSnapshot;
  /** Ticks advanced before the sweep stopped. */
  ticks: number;
}

/**
 * Place ONE round and follow it, tick by tick, until it is spent or its target is
 * gone — or, when neither happens, to the end of {@link ROUND_WINDOW_TICKS}.
 *
 * ONE TICK AT A TIME, because everything this group reads about a split is read AT
 * the kill: the fragments' velocities before the well has had a chance to move
 * them, and the parent's velocity on the tick before. `specs/collision.md` removes
 * the round on the tick it lands, so the tick it leaves the roster is the tick the
 * rock was struck.
 *
 * IT PLACES EXACTLY ONE ROUND, and it never asserts. Whether a spent round is a hit
 * or an absorption, and whether a surviving one is the miss the check wanted, is
 * the check's to say — `radius-*` is decided on exactly that difference.
 */
export async function fireOne(
  h: Harness,
  rockId: number,
  aim: Aim,
  window: number = ROUND_WINDOW_TICKS,
): Promise<Shot> {
  const bullet = poseBullet(h, aim.x, aim.y, aim.vx, aim.vy);
  let before = h.snapshot();

  for (let tick = 1; tick <= window; tick += 1) {
    await h.advance(1);
    const at = h.snapshot();
    const roundGone = bulletById(at, bullet) === undefined;
    const rockGone = rockById(at, rockId) === undefined;
    if (roundGone || rockGone) {
      return {
        bullet,
        spent: roundGone,
        destroyed: rockGone,
        before,
        at,
        ticks: tick,
      };
    }
    before = at;
  }

  const at = h.snapshot();
  return {
    bullet,
    spent: false,
    destroyed: false,
    before,
    at,
    ticks: window,
  };
}

/* -------------------------------------------------------------------------- */
/* Taking a rock down with the gun                                            */
/* -------------------------------------------------------------------------- */

/**
 * The most rounds a gun kill is given before the drive fails.
 *
 * A BOUND ON A SCENARIO, NOT A THRESHOLD. `specs/collision.md` has one round
 * destroy a rock under `base`, and `specs/rocks.md` gives a `warhead` Large
 * `ROCK_HEALTH.large` (`3`) hits of armor before the one that destroys it — a
 * figure `armor/health-large-3` grades, and one this group cannot even import,
 * since a `base` build's `src/constants.ts` does not carry it. Five is the larger
 * of the two with room for a build that resolves a hit a tick late, and small
 * enough that a build whose rounds do not destroy what they strike fails here
 * naming the rule rather than spinning.
 */
export const MAX_GUN_ROUNDS = 5;

/** The tick a rock came apart on, and the tick before it. */
export interface GunKill {
  /**
   * The state on the last tick the parent was still WHOLE, and the last round still
   * in flight: where the parent's velocity is read from.
   */
  before: ShatterSnapshot;
  /** The state on the tick the parent left the roster: the instant of the split. */
  at: ShatterSnapshot;
  /** How many rounds it took. */
  rounds: number;
}

/**
 * Take the rock with that id down WITH THE GUN, and answer the tick it came apart
 * on and the one before it.
 *
 * Rounds go in one at a time, each placed afresh on the rock's CURRENT doorstep and
 * each followed until it is spent, so at most one of this group's rounds is ever in
 * flight and `specs/weapons.md`'s `MAX_BULLETS` cap is never in the way. The build's
 * own collision, armor and split code is what destroys the rock: nothing here
 * removes one.
 *
 * `aim` is how each round is placed, defaulting to {@link headOn}. The fan items
 * pass a horizontal shot instead, because what they read is a perpendicular to the
 * bullet's own travel.
 */
export async function destroyByGun(
  h: Harness,
  rockId: number,
  aim: (target: RockSnapshot) => Aim = headOn,
): Promise<GunKill> {
  for (let round = 1; round <= MAX_GUN_ROUNDS; round += 1) {
    const target = requireRock(
      h.snapshot(),
      rockId,
      "the rock a round is placed on the doorstep of",
    );
    const shot = await fireOne(h, rockId, aim(target));
    if (shot.destroyed) {
      return { before: shot.before, at: shot.at, rounds: round };
    }
    if (!shot.spent) {
      fail(
        `round ${round} to reach the rock on whose doorstep it was placed, ` +
          `${ROUND_STANDOFF} units off its surface closing at MUZZLE_SPEED ` +
          `(${MUZZLE_SPEED}) (specs/collision.md)`,
        `it was still in flight ${ROUND_WINDOW_TICKS} ticks later`,
      );
    }
  }
  fail(
    `the rock destroyed by at most ${MAX_GUN_ROUNDS} rounds placed on its ` +
      "doorstep — a bullet destroys the rock it strikes, and under warhead the " +
      "hit that takes its health to 0 does (specs/collision.md, specs/rocks.md)",
    `rock ${rockId} was still on the field after ${MAX_GUN_ROUNDS} rounds`,
  );
}

/** What a run of rounds fired past a rock at one lateral offset came to. */
export interface Pass {
  /** The rock left the roster: a round at this offset destroyed it. */
  destroyed: boolean;
  /** How many rounds were placed. */
  rounds: number;
  /** The last round placed, and the tick the sweep stopped on. */
  last: Shot;
}

/**
 * Fire rounds past a rock at a fixed lateral `offset` from its centre, along the
 * heading that keeps the star off their line, until the rock is destroyed or a
 * round sails by unspent.
 *
 * The compound the three `radius-*` items share, and it ASSERTS NOTHING: whether a
 * round that was spent is the hit the check wanted, or a round still in flight is
 * the miss it wanted, is the difference those items are decided on.
 *
 * Every round CARRIES THE ROCK'S OWN VELOCITY, so the relative motion is purely
 * along the heading and the `offset` a check states is exactly the distance the
 * round's line passes the rock's centre by, whatever the well has done to the rock
 * by then.
 *
 * IT KEEPS FIRING UNTIL THE ROCK IS GONE because one round is not the same number
 * under both variants: `specs/collision.md` destroys a rock with one hit under
 * `base`, and `specs/rocks.md` gives a `warhead` rock health that only the last hit
 * takes to `0`. A round that MISSES is not spent, so the sweep stops on the first
 * one that sails by and the check reads it.
 */
export async function passAt(
  h: Harness,
  rockId: number,
  offset: number,
): Promise<Pass> {
  let last: Shot | undefined;
  for (let round = 1; round <= MAX_GUN_ROUNDS; round += 1) {
    const target = requireRock(
      h.snapshot(),
      rockId,
      `the rock a round is fired ${offset} units past the centre of`,
    );
    last = await fireOne(
      h,
      rockId,
      roundAlong(target, inwardHeading(target), { offset }),
    );
    if (last.destroyed || !last.spent) {
      return { destroyed: last.destroyed, rounds: round, last };
    }
  }
  // Unreachable on any build whose rounds are spent on what they strike: every
  // round landed and the rock still stands, which `MAX_GUN_ROUNDS` says cannot
  // happen inside the armor `specs/rocks.md` fixes.
  return { destroyed: false, rounds: MAX_GUN_ROUNDS, last: last as Shot };
}

/**
 * How far past a rock's centre a round has travelled, measured along `heading`.
 *
 * A round that is still in flight is only a MISS once it is past the body it was
 * fired at; before then it is a round on its way. The three `radius-*` items assert
 * this of their surviving round, so a build whose collision never runs at all is
 * told from a build whose rock is the size the specification states.
 */
export function travelledPast(
  round: { x: number; y: number },
  rock: Vec,
  heading: number,
): number {
  const separation = shortestSeparation(rock, round);
  return separation.x * Math.cos(heading) + separation.y * Math.sin(heading);
}

/* -------------------------------------------------------------------------- */
/* Reading what a split left                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The two fragments a destroyed rock left, failing with what the scenario needed
 * when the roster does not hold exactly two of the size below it.
 *
 * `specs/rocks.md` fixes both the count and the size: a destroyed `large` leaves two
 * `medium`, a destroyed `medium` two `small`. Hard-asserted before either is read,
 * so a build that split into one — or into none — fails naming the split rather than
 * crashing the script two lines later on a fragment that is not there. That is
 * fold-in fix D's other half: two of the old torpedo assertions dereferenced a body
 * they had only soft-checked, and a build that produced nothing crashed the script
 * and was misreported as failing to expose the debug API at all.
 */
export function fragmentPair(
  snapshot: ShatterSnapshot,
  size: RockSize,
  scenario: string,
): [RockSnapshot, RockSnapshot] {
  const fragments = snapshot.rocks.filter((rock) => rock.size === size);
  if (fragments.length !== 2) {
    fail(
      `${scenario}: two ${size} fragments on the field (specs/rocks.md)`,
      snapshot.rocks.map((rock) => rock.size),
    );
  }
  return [fragments[0], fragments[1]];
}

/** The velocity of a body, as a plain vector. */
export function velocityOf(body: { vx: number; vy: number }): Vec {
  return { x: body.vx, y: body.vy };
}

/** The average of two velocities: the parent's, whatever the kick did. */
export function meanVelocity(a: RockSnapshot, b: RockSnapshot): Vec {
  return { x: (a.vx + b.vx) / 2, y: (a.vy + b.vy) / 2 };
}

/**
 * The difference between two fragments' velocities: TWICE the kick, with the
 * parent's own motion — including every unit per second the well added to it —
 * cancelled exactly.
 *
 * Reading the fan off the PAIR is the other half of fold-in fix C. Each fragment
 * takes the destroyed rock's velocity PLUS a kick, the two kicked to opposite sides
 * (`specs/collision.md`), so the difference is `2 x kick` and nothing else, whatever
 * the parent was doing when it broke.
 */
export function velocityDifference(a: RockSnapshot, b: RockSnapshot): Vec {
  return { x: a.vx - b.vx, y: a.vy - b.vy };
}

/** The magnitude of a planar vector. */
export function lengthOf(v: Vec): number {
  return Math.hypot(v.x, v.y);
}

/** The component of a vector along a heading. */
export function componentAlong(v: Vec, heading: number): number {
  return v.x * Math.cos(heading) + v.y * Math.sin(heading);
}

/* -------------------------------------------------------------------------- */
/* Slinging a rock through the star                                           */
/* -------------------------------------------------------------------------- */

/** Where a rock is dropped from to fall onto the star: straight above its centre. */
export const SLING_FROM: Vec = { x: STAR_X, y: 60 };

/**
 * The inward speed a rock is slung at.
 *
 * Above `ROCK_SPEED_MAX` for every size — the fastest base drift `specs/rocks.md`
 * gives any rock is a Small's `210` — and `specs/gravity.md`'s well only adds to it
 * on the way in. So a rock that re-enters anywhere inside its size's range cannot
 * be carrying the speed it arrived with, and `recycle-resets-speed` states exactly
 * this figure.
 */
export const SLING_SPEED = 400;

/**
 * Inside this a rock is committed to the core, and the sweep that watches for the
 * re-placement begins.
 *
 * Geometry: a Large's circle reaches the core at `CORE_R + ROCK_RADIUS.large` (`76`)
 * from the star's centre (`specs/collision.md`), so a rock reading inside `200` has
 * not been taken yet and is a few dozen units from being.
 */
const COMMITTED = 200;

/**
 * A one-tick move further than this can only be a re-placement.
 *
 * `specs/rocks.md` takes a rock at the core and re-places it at a random point on
 * one of the four edges. The nearest point of any edge to the star's centre is `360`
 * away and the rock is inside `76` when it is taken, so the shortest wrapped
 * separation between where it was and where it re-appears is at least `284`. A rock
 * still drifting covers a handful of units in a tick even after a fall through the
 * well, so nothing but the re-placement clears this — and measuring it as the
 * SHORTEST WRAPPED separation (`specs/field.md`) is what keeps a rock crossing a
 * seam from reading as one.
 *
 * THE RECYCLE IS FOUND AS A DISCONTINUITY, not as the rock reading far from the
 * star. A build that never recycles at all sends its rock straight through the core
 * and out the far side, where it reads exactly as far out as a re-placed one — so a
 * sweep watching a distance would report a recycle that never happened and every
 * item in this group's recycling half would pass vacuously.
 */
const REPLACEMENT_JUMP = 200;

/** A recycle, as the two ticks that bracket it. */
export interface Recycle {
  /** The state on the last tick before the re-placement: the rock still at the core. */
  before: ShatterSnapshot;
  /** The state on the tick the rock re-entered. */
  at: ShatterSnapshot;
}

/** Drop one rock of `size` straight onto the star, and answer its id. */
export function dropOntoTheStar(
  h: Harness,
  size: RockSize,
  speed: number = SLING_SPEED,
): number {
  return poseRock(h, size, SLING_FROM.x, SLING_FROM.y, 0, speed);
}

/**
 * The one rock the recycling scenarios run with, failing when the field holds
 * anything else.
 */
export function theOneRock(
  snapshot: ShatterSnapshot,
  scenario: string,
): RockSnapshot {
  const rock = snapshot.rocks[0];
  if (rock === undefined || snapshot.rocks.length !== 1) {
    fail(
      `${scenario}: exactly one rock on the field (specs/rocks.md)`,
      `the rock roster holds ${snapshot.rocks.length} rocks`,
    );
  }
  return rock;
}

/**
 * Follow the field's one rock into the star and hand back the tick it re-entered on
 * and the tick before it.
 *
 * The march inward is skipped four ticks at a time and the re-placement is then
 * swept ONE TICK AT A TIME, so what a check reads is the state the rock re-entered
 * in rather than one the well has had a chance to work on.
 *
 * The rock is found in the roster rather than by its id: `specs/rocks.md` makes a
 * recycled rock the same rock relocated and leaves the field's rock count
 * unchanged, but it never says the id is preserved, so a check that followed one
 * would be demanding something the specification does not.
 */
export async function slingIntoTheStar(h: Harness): Promise<Recycle> {
  theOneRock(h.snapshot(), "the star's recycling");

  const falling = await h.until(
    (snapshot) =>
      snapshot.rocks.length !== 1 ||
      directDistance(snapshot.rocks[0], STAR) < COMMITTED,
    { maxFrames: ticksFor(6), poll: 4 },
  );
  if (!falling.hit) {
    fail(
      `a rock slung at the star at ${SLING_SPEED} units per second reaching it ` +
        "inside six seconds (specs/gravity.md)",
      `it is still ${directDistance(
        falling.snapshot.rocks[0] ?? SLING_FROM,
        STAR,
      ).toFixed(1)} units out`,
    );
  }

  let before = falling.snapshot;
  for (let tick = 1; tick <= ticksFor(2); tick += 1) {
    await h.advance(1);
    const at = h.snapshot();
    const was = before.rocks[0];
    const now = at.rocks[0];
    if (
      at.rocks.length !== before.rocks.length ||
      was === undefined ||
      now === undefined ||
      wrappedDistance(was, now) > REPLACEMENT_JUMP
    ) {
      return { before, at };
    }
    before = at;
  }

  fail(
    "a rock that reached the star's core taken from it and re-placed on an " +
      "edge (specs/rocks.md)",
    `two seconds on it is still ${directDistance(
      before.rocks[0] ?? SLING_FROM,
      STAR,
    ).toFixed(
      1,
    )} units from the star, having moved no further than a drift in ` +
      "any tick",
  );
}

/**
 * Aim the field's one rock back at the star at {@link SLING_SPEED} and follow it
 * through the core again.
 *
 * How the items that want MANY recycles get them — the two `drift-speed-*` entry
 * items read the speed of every rock a recycle re-enters with, and
 * `recycle-resets-speed` reads a rock through the star repeatedly. Each pass draws
 * afresh from the game's own seeded generator (`specs/simulation.md`), so the
 * samples are the draws the build would make in play rather than one draw read
 * several times.
 */
export async function slingAgain(h: Harness): Promise<Recycle> {
  const rock = theOneRock(
    h.snapshot(),
    "the rock being slung through the star",
  );
  const heading = inwardHeading(rock);
  h.debug.setRockVelocity(
    rock.id,
    Math.cos(heading) * SLING_SPEED,
    Math.sin(heading) * SLING_SPEED,
  );
  return slingIntoTheStar(h);
}

/* -------------------------------------------------------------------------- */
/* The edges                                                                  */
/* -------------------------------------------------------------------------- */

/** One of the four edges `specs/rocks.md` re-places a recycled rock on. */
export interface Edge {
  name: "left" | "right" | "top" | "bottom";
  /** How far the point is from that edge. */
  distance: number;
  /** The unit vector pointing from that edge INTO the field. */
  inward: Vec;
}

/** The edge of the field a point is nearest, and how far from it that point is. */
export function nearestEdge(p: Vec): Edge {
  const candidates: Edge[] = [
    { name: "left", distance: p.x, inward: { x: 1, y: 0 } },
    { name: "right", distance: FIELD_W - p.x, inward: { x: -1, y: 0 } },
    { name: "top", distance: p.y, inward: { x: 0, y: 1 } },
    { name: "bottom", distance: FIELD_H - p.y, inward: { x: 0, y: -1 } },
  ];
  return candidates.reduce((best, edge) =>
    edge.distance < best.distance ? edge : best,
  );
}

/** A Large's whole circle, as the radius a still is framed against. */
export const LARGE_R = ROCK_RADIUS.large;
