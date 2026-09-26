// Shatter — the placements and the compounds the `rocks` checks share.
// CASE-PROVIDED.
//
// This group decides four things about a rock: how wide it collides, what it comes
// apart into and what the pieces carry away, that two of them ignore each other,
// and what the star does with one it swallows. Three shapes recur across the
// twenty-one checks — a round sent past a rock at a measured miss distance, a rock
// shot down and read on the tick it came apart, and a rock slung into the star and
// read on the tick it re-entered — so each is built once, here, rather than
// twenty-one times over in checks that would drift apart.
//
// IT LIVES IN THE GROUP RATHER THAN IN `../harness.ts` because nothing outside
// `rocks` poses any of them: the harness owns what the whole project shares
// (`aimedRound`, `shootRock`, `startPlaying`), and this owns what this group
// shares.
//
// NOT ONE FIGURE BELOW IS A BOUND. Everything here is geometry — a position, a
// run-in, a standoff, the size of a jump that can only be a re-placement — and
// every tolerance stays in the check that asserts it, derived there from the
// figure `specs/` fixes for it.

import {
  BULLET_R,
  FIELD_H,
  FIELD_W,
  MUZZLE_SPEED,
  STAR_X,
  STAR_Y,
} from "../constants";
import { fail } from "../assert";
import {
  directDistanceToStar,
  distance,
  wrapX,
  wrapY,
  type Point,
} from "../geometry";
import {
  ROUND_STANDOFF,
  aimedRound,
  bulletById,
  poseBullet,
  poseRock,
  rockById,
  tapAction,
  ticksFor,
  type AimedRound,
  type Harness,
} from "../harness";
import type {
  FieldEdge,
  RockSize,
  RockSnapshot,
  ShatterSnapshot,
} from "../surface";

/* -------------------------------------------------------------------------- */
/* Small vector arithmetic                                                    */
/* -------------------------------------------------------------------------- */
//
// `../geometry.ts` is the ORACLE — the wrap, the well, the swept contact — and it
// answers questions about the FIELD. These four answer questions about a pair of
// numbers, and are here rather than there because a velocity is not a position and
// nothing in this group wants either confused for the other.

/** The sum of two planar vectors. */
export function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

/** `a` less `b`. */
export function subtract(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

/** A vector scaled by a factor. */
export function scale(v: Point, factor: number): Point {
  return { x: v.x * factor, y: v.y * factor };
}

/** The magnitude of a planar vector. */
export function lengthOf(v: Point): number {
  return Math.hypot(v.x, v.y);
}

/** A velocity, as the pair of numbers the snapshot reports it in. */
export function velocityOf(body: { vx: number; vy: number }): Point {
  return { x: body.vx, y: body.vy };
}

/** A centre, as the pair of numbers the snapshot reports it in. */
export function centreOf(body: { x: number; y: number }): Point {
  return { x: body.x, y: body.y };
}

/** The direction a vector points, in radians, or `null` for a zero vector. */
export function bearingOf(v: Point): number | null {
  if (v.x === 0 && v.y === 0) return null;
  return Math.atan2(v.y, v.x);
}

/** How much of `v` lies ALONG `axis`, in `v`'s own units. `axis` need not be unit. */
export function componentAlong(v: Point, axis: Point): number {
  const length = lengthOf(axis);
  if (length === 0) return 0;
  return (v.x * axis.x + v.y * axis.y) / length;
}

/** How much of `v` lies ACROSS `axis`, signed, in `v`'s own units. */
export function componentAcross(v: Point, axis: Point): number {
  const length = lengthOf(axis);
  if (length === 0) return 0;
  return (v.x * axis.y - v.y * axis.x) / length;
}

/* -------------------------------------------------------------------------- */
/* Quiet ground                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Where every splitting scenario in this group stands its parent rock: `(320, 620)`.
 *
 * The placement the review items name for the two fragment items, and used by the
 * rest of the splitting checks so one figure serves the group. It stands `412`
 * units from the star, where `specs/gravity.md`'s well pulls at about `26` units
 * per second squared — so over the hundredth of a second a round spends crossing
 * its standoff the well adds a quarter of a unit per second to anything a check
 * arranged. That matters most to the fragment items, whose reading is a VELOCITY
 * the split wrote: standing far out is half of the repair the fold-in made, and
 * reading the PAIR ({@link kickOf}) is the other half, so nothing of the well is
 * left in the figure.
 *
 * It is also clear of the star's whole drawn extent (nothing of the star is drawn
 * beyond `180`, `specs/field.md`), clear of the ship's safe point at `(640, 560)`,
 * and a Large's whole circle is inside the field, so nothing a still shows
 * straddles a seam.
 */
export const QUIET_GROUND: Point = { x: 320, y: 620 };

/**
 * The drift the two fragment items pose the parent with: `(-60, -60)`.
 *
 * A DIAGONAL course against a HORIZONTAL shot, which is the whole of fold-in fix C.
 * `specs/collision.md` takes the fan's perpendicular from the bullet's own
 * direction of travel and not from the rock's course; a build that takes it from
 * the rock's course is wrong, and a parent drifting along the shot's own line would
 * make the two conventions agree and let it through. At 45 degrees to the shot the
 * two differ by construction.
 */
export const FAN_DRIFT: Point = { x: -60, y: -60 };

/**
 * The most rounds any one rock in this group is given before a drive gives up.
 *
 * Under `base` a bullet that touches a rock destroys it (`specs/collision.md`), so
 * the first round settles every question here. Under `warhead` a rock carries
 * health and only the hit that takes it to `0` destroys it, a Large's
 * `ROCK_HEALTH.large` (`3`) being the most any size carries (`specs/rocks.md`).
 *
 * The figure is written here rather than imported so that nothing reads it as the
 * requirement: ONE script serves both checklists, and under `base` there is no
 * armor at all.
 * It is a CEILING ON THE ROUNDS A DRIVE SENDS and never an assertion about armor —
 * `armor/health-large-3` is the item that grades the figure, and a build that wants
 * a fourth round must fail there rather than quietly here.
 */
export const MOST_HITS = 3;

/**
 * Open a real game from the title screen, the way a player opens one.
 *
 * The one scenario in this group that cannot be posed. `rocks/drift-speed-large`
 * reads the speed of every Large A WAVE SPAWNS, and no operation on the surface
 * writes one — `setWave` spawns nothing (`specs/instrumentation.md`) — so the game
 * is reset to the title and the highlighted `PLAY` is confirmed with a real key.
 *
 * `reset` leaves `screen` at `"title"` and `menuIndex` at `0`, which
 * `specs/ui.md`'s title menu makes `PLAY`, and it turns both world gates back on:
 * that is why this route never calls `startPlaying`, and why it is the only place
 * in this group where the game's own wave loop runs at all.
 */
export async function startGameFromTitle(h: Harness): Promise<void> {
  h.debug.reset();
  await tapAction(h, "confirm");
}

/* -------------------------------------------------------------------------- */
/* Sending a round past a rock at a measured distance                         */
/* -------------------------------------------------------------------------- */
//
// The three `radius-*` checks each read a PAIR of shots — one inside the size's
// collision radius and one outside it — and the pair is what pins the figure: a
// hit alone would pass a build that collides at any radius at all.
//
// BOTH ROCKS STAND ON THE STAR'S ROW, one on either side of it, so the well's pull
// on each is exactly ALONG the shot and exactly ACROSS nothing the check measures.
// The two rocks are 960 units apart and no round outlives its `BULLET_LIFE` for
// more than 780 units of travel, so neither pair can reach the other;
// `specs/collision.md` gives a rock and a rock, and a bullet and a bullet, no
// interaction anyway.

/** Where the inside-the-radius shot's rock stands: on the star's row, far to its left. */
export const HIT_SPOT: Point = { x: 160, y: STAR_Y };

/** Where the outside-the-radius shot's rock stands: the mirror of it, to the right. */
export const MISS_SPOT: Point = { x: 1120, y: STAR_Y };

/**
 * How far short of the rock a graze round starts, in units.
 *
 * Geometry, not a tolerance. Short enough that the whole approach is an eighth of a
 * second, over which the difference between the well's pull on the round and on the
 * rock — the only thing that can move the miss distance the check arranged — is
 * under a tenth of a unit; long enough that the round begins well clear of every
 * radius this group shoots at, so what resolves the shot is the build's own
 * collision pass rather than an overlap the pose created.
 */
export const GRAZE_RUN_IN = 60;

/** Which way along the row a round fired at `spot` travels: toward the star. */
export function grazeHeading(spot: Point): number {
  return spot.x < STAR_X ? 1 : -1;
}

/**
 * The round that passes `spot` at exactly `offset` units, measured across its travel.
 *
 * It is laid on the star's row travelling along it, so its closest approach to a
 * rock standing at `spot` is the `offset` it was given, and the well acts along the
 * travel rather than across it.
 */
export function grazeRound(spot: Point, offset: number): AimedRound {
  const heading = grazeHeading(spot);
  return {
    x: wrapX(spot.x - heading * GRAZE_RUN_IN),
    y: wrapY(spot.y + offset),
    vx: heading * MUZZLE_SPEED,
    vy: 0,
  };
}

/** What a run of graze rounds past one rock came to. */
export interface Graze {
  /** Whether the rock left the roster: destroyed by the rounds sent at it. */
  gone: boolean;
  /** How many rounds were actually placed. */
  rounds: number;
  /** The id of the last round placed, for a check that reads its flight back. */
  bullet: number;
  /** The state after the last round had been followed. */
  snapshot: ShatterSnapshot;
}

/**
 * Send up to `rounds` rounds past the rock, each passing `offset` units from where
 * it then stands, following each for `followTicks` before the next.
 *
 * MORE THAN ONE ROUND, BECAUSE THIS GROUP'S CHECKS RUN UNDER BOTH VARIANTS. Under
 * `base` a bullet that touches a rock destroys it (`specs/collision.md`) and the
 * first round settles the question; under `warhead` a rock carries health and only
 * the last of its hits destroys it, so a check reading destruction has to send that
 * many. The run stops the moment the rock is gone, so a `base` build is never shot
 * at twice.
 *
 * EACH ROUND IS LAID FROM WHERE THE ROCK THEN STANDS, so the miss distance is the
 * one the caller asked for on every round rather than only on the first: a rock left
 * at rest still falls toward the star, and on the star's own row it falls exactly
 * along the round's travel and not across it.
 *
 * Each round is followed for a fixed span rather than until it leaves the roster,
 * so a round that struck nothing is STILL IN FLIGHT when the caller reads it back —
 * which is how the outside-the-radius half of a `radius-*` check says that its round
 * really went by rather than that it never arrived.
 */
export async function grazePast(
  h: Harness,
  rockId: number,
  offset: number,
  rounds: number,
  followTicks: number,
): Promise<Graze> {
  let snapshot = h.snapshot();
  let bullet = -1;
  let placed = 0;
  for (let round = 1; round <= rounds; round += 1) {
    const standing = findRock(snapshot, rockId);
    if (standing === undefined) break;
    const shot = grazeRound(centreOf(standing), offset);
    bullet = poseBullet(h, shot.x, shot.y, shot.vx, shot.vy);
    placed = round;
    await h.advance(followTicks);
    snapshot = h.snapshot();
  }
  if (placed === 0) {
    fail(
      `a rock with id ${rockId} on the field to send a round past ` +
        "(specs/instrumentation.md)",
      snapshot.rocks.map((rock) => rock.id),
    );
  }
  return {
    gone: findRock(snapshot, rockId) === undefined,
    rounds: placed,
    bullet,
    snapshot,
  };
}

/**
 * How far past the column its rock stands in a round has travelled, in units.
 *
 * Positive once the round is beyond the rock, so the outside-the-radius half of a
 * `radius-*` check can say that its round really went by rather than that it never
 * arrived. Measured across the seams, as `specs/field.md` measures every
 * separation.
 */
export function travelPast(
  bullet: { x: number },
  rock: { x: number },
  spot: Point,
): number {
  const separation = bullet.x - rock.x;
  const folded = separation - FIELD_W * Math.round(separation / FIELD_W);
  return folded * grazeHeading(spot);
}

/* -------------------------------------------------------------------------- */
/* Reading a roster                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The rock with that id, or `undefined` when the roster no longer holds it.
 *
 * The SOFT reading, beside the harness's hard-asserting `rockById`. Half of this
 * group's checks are about a rock that must be GONE, and a helper that failed on a
 * missing rock could not express the requirement.
 */
export function findRock(
  snapshot: ShatterSnapshot,
  id: number,
): RockSnapshot | undefined {
  return snapshot.rocks.find((rock) => rock.id === id);
}

/** Every rock on the field of one size, in roster order. */
export function rocksOfSize(
  snapshot: ShatterSnapshot,
  size: RockSize,
): RockSnapshot[] {
  return snapshot.rocks.filter((rock) => rock.size === size);
}

/* -------------------------------------------------------------------------- */
/* Shooting a rock down, and reading the tick it came apart                   */
/* -------------------------------------------------------------------------- */

/**
 * The most ticks one round is given to cross its standoff.
 *
 * A round is placed a rock's radius plus fifteen units out and closes at
 * `MUZZLE_SPEED` (`520`), so contact falls inside a tick or two; this is that with
 * two orders of room, so a build whose rounds do not land fails with what the
 * scenario needed named rather than hanging the suite.
 */
const ROUND_FLIGHT_TICKS = ticksFor(0.25);

/** What a kill came to: the rounds it took, and the two ticks that bracket it. */
export interface Kill {
  /** How many rounds were placed before the rock came apart. */
  rounds: number;
  /**
   * The state on the last tick the parent was STILL STANDING.
   *
   * What every fragment check reads the parent's velocity and centre off, so the
   * figure a check compares against is the one the parent held when the round
   * landed and never one the well built afterwards.
   */
  before: ShatterSnapshot;
  /** The state on the tick the parent LEFT the roster: the instant of the split. */
  at: ShatterSnapshot;
  /** The round that landed, still in flight in {@link before}. */
  bullet: number;
}

/**
 * Place rounds on a rock's doorstep, one after another, until it comes apart, and
 * report the tick it did and the tick before it.
 *
 * `round` decides where each one comes from: {@link aimedRound} for a check that
 * only wants the rock dead, {@link horizontalRound} for the fragment checks, whose
 * requirement is fixed relative to the bullet's own direction of travel.
 *
 * MORE THAN ONE ROUND, BECAUSE THIS GROUP'S CHECKS RUN UNDER BOTH VARIANTS: see
 * {@link MOST_HITS}. Each round is aimed afresh at where the rock then stands, so a
 * drifting parent is struck head-on every time.
 *
 * The ceiling is {@link MOST_HITS} with room to spare rather than {@link MOST_HITS}
 * exactly, so a build that resolves one hit a tick late still reaches the split it
 * owes and a build that wants a fourth hit fails `armor/health-large-3` — the item
 * that grades the figure — rather than silently failing every splitting item here.
 */
export async function killWith(
  h: Harness,
  rockId: number,
  round: (rock: RockSnapshot) => AimedRound,
  options: { maxRounds?: number } = {},
): Promise<Kill> {
  const maxRounds = options.maxRounds ?? MOST_HITS + 5;
  for (let rounds = 1; rounds <= maxRounds; rounds += 1) {
    const standing = rockById(
      h.snapshot(),
      rockId,
      "the rock a round was aimed at",
    );
    const shot = round(standing);
    const bullet = poseBullet(h, shot.x, shot.y, shot.vx, shot.vy);
    let before = h.snapshot();
    for (let tick = 1; tick <= ROUND_FLIGHT_TICKS; tick += 1) {
      await h.advance(1);
      const at = h.snapshot();
      if (findRock(at, rockId) === undefined) {
        return { rounds, before, at, bullet };
      }
      if (!at.bullets.some((entry) => entry.id === bullet)) break;
      before = at;
    }
  }
  fail(
    `a rock destroyed by at most ${maxRounds} rounds placed on its doorstep ` +
      "(specs/collision.md)",
    `rock ${rockId} was still on the field after ${maxRounds} rounds`,
  );
}

/** Shoot a rock down with rounds sent inward from the side facing away from the star. */
export function killRock(h: Harness, rockId: number): Promise<Kill> {
  return killWith(h, rockId, (rock) => aimedRound(rock));
}

/**
 * The round that strikes `target` travelling exactly along the field's `x` axis.
 *
 * The fragment items pose their parent drifting diagonally and shoot it
 * HORIZONTALLY, so the perpendicular `specs/collision.md` fixes the fan across —
 * the bullet's travel — and the direction a wrong build takes it across — the
 * rock's course — differ by 45 degrees and cannot be confused for one another.
 *
 * It carries NONE of the target's velocity, unlike {@link aimedRound}: the whole
 * point is a shot whose own travel is a known, fixed direction, and adding the
 * parent's drift to it would tilt exactly the line the check measures against. The
 * approach is three hundredths of a second, over which a parent drifting at `85`
 * units per second slides two and a half units across a standoff of `61` — against
 * a Large's radius of `46`, so the round still lands head-on.
 *
 * It comes from the side facing away from the star along `x`, so
 * `specs/collision.md`'s absorption at the core cannot take it on the way in.
 */
export function horizontalRound(target: RockSnapshot): AimedRound {
  const outward = target.x <= STAR_X ? -1 : 1;
  const reach = target.radius + BULLET_R + ROUND_STANDOFF;
  return {
    x: wrapX(target.x + outward * reach),
    y: wrapY(target.y),
    vx: -outward * MUZZLE_SPEED,
    vy: 0,
  };
}

/** Shoot a rock down with rounds travelling exactly along the field's `x` axis. */
export function killHorizontally(h: Harness, rockId: number): Promise<Kill> {
  return killWith(h, rockId, horizontalRound);
}

/** The round a kill landed, still in flight on the tick before it landed. */
export function fatalRound(kill: Kill): Point {
  const round = bulletById(
    kill.before,
    kill.bullet,
    "the round in flight on the tick before it landed",
  );
  return velocityOf(round);
}

/* -------------------------------------------------------------------------- */
/* Reading the fan                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The two fragments a destroyed rock left, failing with what the scenario needed
 * when the roster does not hold exactly two of the size below it.
 *
 * `specs/rocks.md` fixes both the count and the size: a destroyed `large` leaves
 * two `medium`, a destroyed `medium` two `small`. Hard-asserted before either is
 * read, so a build that split into one — or into none — fails the item about
 * splitting rather than crashing the script two lines later and being misreported
 * as failing to expose the debug surface.
 */
export function fragmentPair(
  snapshot: ShatterSnapshot,
  size: RockSize,
  scenario: string,
): [RockSnapshot, RockSnapshot] {
  const fragments = rocksOfSize(snapshot, size);
  if (fragments.length !== 2) {
    fail(
      `${scenario}: two ${size} fragments on the field (specs/rocks.md)`,
      snapshot.rocks.map((rock) => rock.size),
    );
  }
  return [fragments[0], fragments[1]];
}

/**
 * Half the difference between two fragments' velocities: the kick one of them took,
 * with the parent's own motion cancelled.
 *
 * READ OFF THE PAIR, which is what makes it honest. `specs/collision.md` gives each
 * fragment the destroyed rock's velocity PLUS a kick, the two kicked to opposite
 * sides, so the difference between the two velocities is twice the kick and the
 * parent's motion — including every unit per second the well added to it on the way
 * in — falls out exactly. That is the second half of fold-in fix C: no placement
 * can let the environment into the figure.
 */
export function kickOf(a: RockSnapshot, b: RockSnapshot): Point {
  return scale(subtract(velocityOf(a), velocityOf(b)), 0.5);
}

/* -------------------------------------------------------------------------- */
/* Slinging a rock into the star                                              */
/* -------------------------------------------------------------------------- */

/** Where a rock is dropped from to fall onto the star: straight above its centre. */
export const FALL_FROM: Point = { x: STAR_X, y: 60 };

/** The inward speed a rock is dropped at, so the fall is a second rather than four. */
export const FALL_SPEED = 150;

/**
 * Inside this the rock is committed to the core, and the sweep that watches for the
 * re-placement begins.
 *
 * Geometry: the largest rock's circle reaches the core at `CORE_R +
 * ROCK_RADIUS.large` (`76`) from the star's centre (`specs/collision.md`), so a
 * rock reading inside `200` has not yet been taken and is a few dozen units from
 * being.
 */
const COMMITTED = 200;

/**
 * A one-tick move further than this can only be a re-placement.
 *
 * `specs/rocks.md` takes a rock at the core and re-places it on one of the four
 * edges of the field. The nearest point of any edge to the star's centre is `360`
 * away, and the rock is inside `76` when it is taken, so the shortest wrapped
 * separation between where it was and where it re-appears is at least `284`. A rock
 * still drifting covers at most a handful of units in a tick even after a fall
 * through the well, so nothing but the re-placement can clear this — and measuring
 * it as the SHORTEST WRAPPED separation (`specs/field.md`) is what keeps a rock
 * crossing a seam from reading as one.
 */
const REPLACEMENT_JUMP = 200;

/** A recycle, as the two ticks that bracket it. */
export interface Recycle {
  /** The state on the last tick before the re-placement: the rock still at the core. */
  before: ShatterSnapshot;
  /** The state on the tick the rock re-entered. */
  at: ShatterSnapshot;
}

/**
 * Drop the field's one rock onto the star and hand back the tick it re-entered on
 * and the tick before it.
 *
 * The rock is posed straight above the star's centre, so the well's pull is exactly
 * along its fall and the approach is radial: it reaches the core rather than
 * swinging past it. The march inward is skipped, and the re-placement is then swept
 * one tick at a time, so what a check reads is the state the rock re-entered in and
 * not one the well has had a chance to work on.
 *
 * THE RECYCLE IS FOUND AS A DISCONTINUITY, not as the rock reading far from the
 * star. A build that never recycles at all sends its rock straight through the core
 * and out the far side, where it reads exactly as far out as a re-placed one — so a
 * sweep watching a distance would report a recycle that never happened and every
 * check in the group would pass vacuously. A jump of {@link REPLACEMENT_JUMP} units
 * inside one tick is the thing itself.
 *
 * The rock is found in the roster rather than by its id: `specs/rocks.md` makes a
 * recycled rock the same rock relocated and leaves the field's rock count
 * unchanged, but it never says the id is preserved, so a check that followed one
 * would be demanding something the specification does not.
 */
export async function slingIntoTheStar(h: Harness): Promise<Recycle> {
  const posed = h.snapshot();
  if (posed.rocks.length !== 1) {
    fail(
      "the star's recycling reached with exactly one rock on the field " +
        "(specs/rocks.md)",
      `the rock roster holds ${posed.rocks.length} rocks`,
    );
  }

  const falling = await h.until(
    (snapshot) =>
      snapshot.rocks.length !== 1 ||
      directDistanceToStar(snapshot.rocks[0]) < COMMITTED,
    { maxFrames: ticksFor(6), poll: 4 },
  );
  if (!falling.hit) {
    fail(
      `a rock dropped from y=${FALL_FROM.y} reaching the star inside six ` +
        "seconds (specs/gravity.md)",
      `it was still ${directDistanceToStar(
        falling.snapshot.rocks[0] ?? FALL_FROM,
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
      distance(centreOf(was), centreOf(now)) > REPLACEMENT_JUMP
    ) {
      return { before, at };
    }
    before = at;
  }
  fail(
    "a rock that reached the star's core taken from it and re-placed on an " +
      "edge (specs/rocks.md)",
    `two seconds on it was still ${directDistanceToStar(
      before.rocks[0] ?? FALL_FROM,
    ).toFixed(
      1,
    )} units from the star, having moved no further than a drift in any tick`,
  );
}

/** Drop one rock of `size` straight onto the star at `speed`, and answer its id. */
export function dropOntoTheStar(
  h: Harness,
  size: RockSize,
  speed: number = FALL_SPEED,
): number {
  return poseRock(h, size, FALL_FROM.x, FALL_FROM.y, 0, speed);
}

/** The one rock the recycling scenario runs with, failing when it is gone. */
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

/* -------------------------------------------------------------------------- */
/* The edges                                                                  */
/* -------------------------------------------------------------------------- */
//
// THE FIELD'S FOUR EDGES ARE TWO SEAMS. `specs/field.md`, "The wrap": "The field
// wraps on both axes, so it is a torus. A body's position is kept in range by
// wrapping each coordinate: `x` modulo `FIELD_W` and `y` modulo `FIELD_H`." The
// left edge and the right edge are therefore ONE LINE — `x = 0` and `x = FIELD_W`
// are the same coordinate once the wrap is taken — and so are the top and the
// bottom. A build that re-places a recycled rock ON the right edge reports it at
// `x = 0`, and one that re-places it on the bottom reports `y = 0`, because that
// is what wrapping the coordinate does to `FIELD_W` and to `FIELD_H`.
//
// SO POSITION ALONE CANNOT NAME THE EDGE ON THE SEAM ITSELF, AND THE VELOCITY MUST.
// What tells the two edges meeting at a seam apart is which way the field lies from
// each: a rock that came back at the right edge travels in `-x`, one that came back
// at the left travels in `+x`, and `specs/rocks.md` has every re-entry "heading
// inward into the field", so every conforming re-entry carries that sign.
//
// AWAY FROM THE SEAM, THE DISTANCE DOES NAME IT. {@link distanceFromEdge} measures
// how far INTO the field a point stands from the edge named, taken around the wrap,
// so it reads `0` for both of a seam's edges only ON the seam — the one place the
// two spellings `0` and `FIELD_W` coincide. Fifty units in from the left reads `50`
// from the left edge and `1230` from the right, so a rock re-placed past the far
// end of a seam and heading straight back out through it is read as the far edge's
// business, not as an entry at this one. Distance for WHERE, and the inward
// component for WHICH of a seam's two edges, is the reading the wrap admits.

/** One of the field's four edges, and the direction into the field from it. */
export interface Edge {
  name: string;
  /** How far into the field the point stands from that edge, in units. */
  distance: number;
  /** The unit vector pointing from that edge into the field. */
  inward: Point;
}

/** The four edges `specs/rocks.md` draws a recycled rock's re-entry from. */
export const FIELD_EDGES: readonly FieldEdge[] = [
  "left",
  "right",
  "top",
  "bottom",
];

/** The unit vector pointing from one named edge of the field into the field. */
export function inwardFrom(edge: FieldEdge): Point {
  switch (edge) {
    case "left":
      return { x: 1, y: 0 };
    case "right":
      return { x: -1, y: 0 };
    case "top":
      return { x: 0, y: 1 };
    case "bottom":
      return { x: 0, y: -1 };
  }
}

/**
 * How far a point stands INTO the field from one named edge, in units, measured
 * around the wrap.
 *
 * The reading a posed re-entry is graded by: `specs/rocks.md` draws the point
 * uniformly along the whole length of the posed edge and pins no inset for the
 * centre, so a rock coming back near a corner can stand nearer to the
 * perpendicular edge than to the one it entered at, and only its distance from the
 * edge that was posed says anything.
 *
 * IT IS MEASURED INWARD FROM THAT EDGE, so a rock re-placed at the right edge reads
 * `0` whether the build wrote `x = FIELD_W` or the `x = 0` the wrap turns that into
 * — the two spellings of the one seam. A seam's two edges therefore agree only ON
 * the seam: fifty units in from the left reads `50` from the left edge and `1230`
 * from the right, so a rock re-placed past the far end of a seam and heading
 * straight back out through it does not read as an entry at this edge. Which of a
 * seam's two edges a rock standing ON the seam came back at is read from
 * {@link inwardFrom} and its velocity.
 */
export function distanceFromEdge(point: Point, edge: FieldEdge): number {
  switch (edge) {
    case "left":
      return wrapX(point.x);
    case "right":
      return wrapX(FIELD_W - point.x);
    case "top":
      return wrapY(point.y);
    case "bottom":
      return wrapY(FIELD_H - point.y);
  }
}

/** How far a point stands from the nearest of the field's four edges, in units. */
export function distanceFromAnyEdge(point: Point): number {
  return Math.min(...FIELD_EDGES.map((edge) => distanceFromEdge(point, edge)));
}

/**
 * The edge a body standing within `reach` of a seam came into the field at, or
 * `null` when it stands at no edge at all.
 *
 * `specs/field.md` gives the field no walls and `specs/rocks.md` re-places a
 * recycled rock at "a point on one of the four edges of the field, the edge drawn
 * with probability `1/4` each and the point drawn uniformly along the whole length
 * of that edge, heading inward into the field", so the reading has to be taken
 * against the edge the rock actually came back at rather than against a fixed one.
 *
 * THE CANDIDATES ARE THE EDGES THE BODY STANDS ON, and the velocity picks between
 * them. A point on the `x` seam is on the left edge and on the right edge at once;
 * a point in a corner is on all four; and the one it came in at is the one the
 * field lies inward of from where it is heading. Taking the greatest inward
 * component over the candidates is exactly that, and it names no edge the body is
 * not standing on — a rock left in the middle of the field answers `null` and a
 * rock sliding ALONG a seam answers an edge with no inward component at all, so
 * neither can be read as an entry.
 */
export function entryEdge(
  body: Point & { vx: number; vy: number },
  reach: number,
): Edge | null {
  const candidates = FIELD_EDGES.map((edge) => ({
    name: `the ${edge} edge`,
    distance: distanceFromEdge(body, edge),
    inward: inwardFrom(edge),
  })).filter((edge) => edge.distance <= reach);
  if (candidates.length === 0) return null;
  const velocity = velocityOf(body);
  return candidates.reduce((best, edge) =>
    componentAlong(velocity, edge.inward) >
    componentAlong(velocity, best.inward)
      ? edge
      : best,
  );
}

/** The star's centre, as a point (`specs/field.md`). */
export const STAR: Point = { x: STAR_X, y: STAR_Y };
