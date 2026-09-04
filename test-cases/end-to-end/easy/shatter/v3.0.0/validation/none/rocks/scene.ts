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

import { fail } from "../assert";
import {
  BULLET_R,
  FIELD_H,
  FIELD_W,
  MUZZLE_SPEED,
  STAR_X,
  STAR_Y,
  type RockSize,
} from "../constants";
import {
  scale,
  shortestAxis,
  starDistance,
  subtract,
  wrapX,
  wrapY,
  wrappedDistance,
  type Vec,
} from "../geometry";
import {
  ROUND_STANDOFF,
  aimedRound,
  bulletById,
  centreOf,
  poseBullet,
  requireRock,
  rockById,
  ticksFor,
  velocityOf,
  type Harness,
  type RockView,
  type Round,
  type ShatterSnapshot,
  type Target,
} from "../harness";

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
export const QUIET_GROUND: Vec = { x: 320, y: 620 };

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
export const FAN_DRIFT: Vec = { x: -60, y: -60 };

/* -------------------------------------------------------------------------- */
/* Sending a round past a rock at a measured distance                         */
/* -------------------------------------------------------------------------- */
//
// The three `radius-*` checks each read a PAIR of shots — one inside the size's
// collision radius and one outside it — and the pair is what pins the figure: a
// hit alone would pass a build that collides at any radius at all.
//
// BOTH ROCKS STAND ON THE STAR'S ROW, one on either side of it, so the well's pull
// on each is exactly ALONG the shot and exactly ACROSS the miss distance the check
// measures. The two rocks are 960 units apart and neither shot travels 200, so
// neither pair can reach the other; `specs/collision.md` gives a rock and a rock,
// and a bullet and a bullet, no interaction anyway.

/** Where the inside-the-radius shot's rock stands: on the star's row, far to its left. */
export const HIT_SPOT: Vec = { x: 160, y: STAR_Y };

/** Where the outside-the-radius shot's rock stands: the mirror of it, to the right. */
export const MISS_SPOT: Vec = { x: 1120, y: STAR_Y };

/**
 * How far short of the rock a graze round starts, in units.
 *
 * Geometry, not a tolerance. Short enough that the whole approach is a seventh of a
 * second, over which the difference between the well's pull on the round and on the
 * rock — the only thing that can move the miss distance the check arranged — is
 * under a hundredth of a unit; long enough that the round begins well clear of
 * every radius this group shoots at, so what resolves the shot is the build's own
 * collision pass rather than an overlap the pose created.
 */
export const GRAZE_RUN_IN = 60;

/** Which way along the row a round fired at `spot` travels: toward the star. */
export function grazeHeading(spot: Vec): number {
  return spot.x < STAR_X ? 1 : -1;
}

/**
 * The round that passes `spot` at exactly `offset` units, measured across its travel.
 *
 * It is laid on the star's row travelling along it, so its closest approach to a
 * rock standing at `spot` is the `offset` it was given, and the well acts along the
 * travel rather than across it.
 */
export function grazeRound(spot: Vec, offset: number): Round {
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
 * first round settles the question; under `warhead` a rock carries `ROCK_HEALTH`
 * hits and only the last of them destroys it, so a check reading destruction has to
 * send that many. The run stops the moment the rock is gone, so a `base` build is
 * never shot at twice.
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
  let snapshot = await h.snapshot();
  let bullet = -1;
  let placed = 0;
  for (let round = 1; round <= rounds; round += 1) {
    const standing = rockById(snapshot, rockId);
    if (standing === undefined) break;
    const shot = grazeRound(centreOf(standing), offset);
    bullet = await poseBullet(h, shot.x, shot.y, shot.vx, shot.vy);
    placed = round;
    await h.advance(followTicks);
    snapshot = await h.snapshot();
  }
  if (placed === 0) {
    fail(
      `${rockId}: a rock on the field to send a round past (specs/instrumentation.md)`,
      `the rock roster holds ${JSON.stringify(snapshot.rocks.map((r) => r.id))}`,
    );
  }
  return {
    gone: rockById(snapshot, rockId) === undefined,
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
 * arrived. Measured across the seams, as `specs/field.md` measures every separation.
 */
export function travelPast(
  bullet: { x: number },
  rock: { x: number },
  spot: Vec,
): number {
  return shortestAxis(rock.x, bullet.x, FIELD_W) * grazeHeading(spot);
}

/* -------------------------------------------------------------------------- */
/* Posing a rock                                                              */
/* -------------------------------------------------------------------------- */

/** One rock of `size` at a point, at rest, with its id. */
export async function poseRockAt(
  h: Harness,
  size: RockSize,
  at: Vec,
  velocity: Vec = { x: 0, y: 0 },
): Promise<number> {
  await h.debug.addRock(size, at.x, at.y);
  const snapshot = await h.snapshot();
  const added = snapshot.rocks[snapshot.rocks.length - 1];
  if (added === undefined) {
    fail(
      "addRock to append a rock to the roster (specs/instrumentation.md)",
      "the rock roster was still empty after addRock",
    );
  }
  await h.debug.setRockVelocity(added.id, velocity.x, velocity.y);
  return added.id;
}

/* -------------------------------------------------------------------------- */
/* Shooting a rock down, and reading the tick it came apart                   */
/* -------------------------------------------------------------------------- */

/**
 * The most ticks one round is given to cross its standoff.
 *
 * A round is placed a rock's radius plus seven units out and closes at
 * `MUZZLE_SPEED`, so contact falls inside a tick or two; this is that with two
 * orders of room, so a build whose rounds do not land fails with what the scenario
 * needed named rather than hanging the suite.
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
 * only wants the rock dead, {@link horizontalRound} for the two fragment checks,
 * whose requirement is fixed relative to the bullet's own direction of travel.
 *
 * MORE THAN ONE ROUND, BECAUSE THIS GROUP'S CHECKS RUN UNDER BOTH VARIANTS. Under
 * `warhead` a rock carries `ROCK_HEALTH` hits (`specs/rocks.md`) and only the hit
 * that takes health to `0` splits it, so a Large takes three; under `base` the
 * first round does it. Each round is aimed afresh at where the rock then stands, so
 * a drifting parent is struck head-on every time.
 */
export async function killWith(
  h: Harness,
  rockId: number,
  round: (rock: RockView) => Round,
  options: { maxRounds?: number } = {},
): Promise<Kill> {
  const maxRounds = options.maxRounds ?? 8;
  for (let rounds = 1; rounds <= maxRounds; rounds += 1) {
    const standing = requireRock(await h.snapshot(), rockId, "killWith");
    const shot = round(standing);
    const bullet = await poseBullet(h, shot.x, shot.y, shot.vx, shot.vy);
    let before = await h.snapshot();
    for (let tick = 1; tick <= ROUND_FLIGHT_TICKS; tick += 1) {
      const at = await h.advance(1);
      if (rockById(at, rockId) === undefined) {
        return { rounds, before, at, bullet };
      }
      if (bulletById(at, bullet) === undefined) break;
      before = at;
    }
  }
  fail(
    `a rock destroyed by at most ${maxRounds} rounds placed on its doorstep (specs/collision.md)`,
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
 * The two fragment items pose their parent drifting diagonally and shoot it
 * HORIZONTALLY, so the perpendicular `specs/collision.md` fixes the fan across —
 * the bullet's travel — and the direction a wrong build takes it across — the
 * rock's course — differ by 45 degrees and cannot be confused for one another.
 *
 * It carries NONE of the target's velocity, unlike {@link aimedRound}: the whole
 * point is a shot whose own travel is a known, fixed direction, and adding the
 * parent's drift to it would tilt exactly the line the check measures against. The
 * approach is a hundredth of a second, over which a parent drifting at `85` units
 * per second slides half a unit across a standoff of `53`, so the round still lands
 * head-on.
 *
 * It comes from the side facing away from the star along `x`, so `specs/collision.md`'s
 * absorption at the core cannot take it on the way in.
 */
export function horizontalRound(target: Target): Round {
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
): [RockView, RockView] {
  const fragments = snapshot.rocks.filter((rock) => rock.size === size);
  if (fragments.length !== 2) {
    fail(
      `${scenario}: two ${size} fragments on the field (specs/rocks.md)`,
      `the rock roster held ${JSON.stringify(
        snapshot.rocks.map((rock) => rock.size),
      )}`,
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
export function kickOf(a: RockView, b: RockView): Vec {
  return scale(subtract(velocityOf(a), velocityOf(b)), 0.5);
}

/* -------------------------------------------------------------------------- */
/* Slinging a rock into the star                                              */
/* -------------------------------------------------------------------------- */

/** Where a rock is dropped from to fall onto the star: straight above its centre. */
export const FALL_FROM: Vec = { x: STAR_X, y: 60 };

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
  const posed = await h.snapshot();
  if (posed.rocks.length !== 1) {
    fail(
      "the star's recycling reached with exactly one rock on the field (specs/rocks.md)",
      `the rock roster holds ${posed.rocks.length} rocks`,
    );
  }

  const falling = await h.skipUntil(
    (snapshot) =>
      snapshot.rocks.length !== 1 ||
      starDistance(snapshot.rocks[0]) < COMMITTED,
    { maxTicks: ticksFor(6), poll: 4 },
  );
  if (!falling.hit) {
    fail(
      `a rock dropped from ${FALL_FROM.y} reaching the star inside six seconds (specs/gravity.md)`,
      `it was still ${starDistance(
        falling.snapshot.rocks[0] ?? FALL_FROM,
      ).toFixed(1)} units out`,
    );
  }

  let before = falling.snapshot;
  for (let tick = 1; tick <= ticksFor(2); tick += 1) {
    const at = await h.advance(1);
    const was = before.rocks[0];
    const now = at.rocks[0];
    if (
      at.rocks.length !== before.rocks.length ||
      was === undefined ||
      now === undefined ||
      wrappedDistance(centreOf(was), centreOf(now)) > REPLACEMENT_JUMP
    ) {
      return { before, at };
    }
    before = at;
  }
  fail(
    "a rock that reached the star's core taken from it and re-placed on an edge (specs/rocks.md)",
    `two seconds on it was still ${starDistance(
      before.rocks[0] ?? FALL_FROM,
    ).toFixed(
      1,
    )} units from the star, having moved no further than a drift in any tick`,
  );
}

/** The one rock the recycling scenario runs with, failing when it is gone. */
export function theOneRock(
  snapshot: ShatterSnapshot,
  scenario: string,
): RockView {
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

/** One of the field's four edges, and the direction into the field from it. */
export interface Edge {
  name: string;
  /** How far the point was from it, in units. */
  distance: number;
  /** The unit vector pointing from that edge into the field. */
  inward: Vec;
}

/**
 * Which of the four edges a point is nearest, how far it is from it, and which way
 * the field lies from there.
 *
 * `specs/field.md` gives the field no walls and `specs/rocks.md` re-places a
 * recycled rock "at a random point on one of the four edges of the field, heading
 * inward into the field", so both of those readings are taken against the edge the
 * rock actually came back at rather than against a fixed one.
 */
export function nearestEdge(point: Vec): Edge {
  const edges: Edge[] = [
    { name: "the left edge", distance: point.x, inward: { x: 1, y: 0 } },
    {
      name: "the right edge",
      distance: FIELD_W - point.x,
      inward: { x: -1, y: 0 },
    },
    { name: "the top edge", distance: point.y, inward: { x: 0, y: 1 } },
    {
      name: "the bottom edge",
      distance: FIELD_H - point.y,
      inward: { x: 0, y: -1 },
    },
  ];
  return edges.reduce((nearest, edge) =>
    edge.distance < nearest.distance ? edge : nearest,
  );
}

/** The star's centre, as a point. */
export const STAR: Vec = { x: STAR_X, y: STAR_Y };
