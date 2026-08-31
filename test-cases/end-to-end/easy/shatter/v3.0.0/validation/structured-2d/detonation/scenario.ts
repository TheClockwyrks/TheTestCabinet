// Shatter — the placements and the compounds the `detonation` checks share.
// CASE-PROVIDED.
//
// This group decides two pairs of `specs/collision.md`: a torpedo and a rock, and
// a torpedo and the saucer. Every check in it therefore arranges the same shape —
// a body standing on quiet ground, and one torpedo placed on its doorstep and
// flown into it — so that shape is built once, here, rather than ten times over in
// ten checks that would drift apart.
//
// IT LIVES IN THE GROUP RATHER THAN IN `../harness.ts` because nothing outside
// `detonation` poses it: the `torpedo` group flies torpedoes to read their
// guidance, their turn rate and their lifetime, never to land one. The harness
// owns what the whole project shares — `aimedRound`, `poseRock`, `poseBullet`,
// `startPlaying` — and it can only know the surface EVERY variant has; what is
// here reaches `addTorpedo` and `setTorpedoHoming`, which `specs/instrumentation.md`
// owes a `warhead` build alone, and is wanted only by the ten `detonation` checks,
// which never load against a `base` build.
//
// NOT ONE FIGURE BELOW IS A BOUND. Everything here is geometry and patience — a
// position, a heading, a standoff, how long one flight is followed — and every
// tolerance stays in the check that asserts it, derived there from the figure
// `specs/` fixes for it.

import {
  MUZZLE_SPEED,
  ROCK_HEALTH,
  TICK_DT,
  TORPEDO_R,
  TORPEDO_SPEED,
} from "../../src/constants";
import { fail } from "../assert";
import { QUIET_CORNER } from "../fixtures";
import { DEG, STAR, angleBetween, wrapPoint, type Vec } from "../geometry";
import {
  ROUND_STANDOFF,
  aimedRound,
  poseBullet,
  requireRock,
  rockById,
  ticksFor,
  torpedoesOf,
  type Harness,
  type RockSize,
  type RockSnapshot,
  type ShatterSnapshot,
} from "../harness";
import { requireOp } from "../surface";

/* -------------------------------------------------------------------------- */
/* Quiet ground                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Where every scenario in this group stands its target: the harness's own quiet
 * corner, `(320, 620)`.
 *
 * `412` units from the star, where `specs/gravity.md`'s well pulls at about `26`
 * units per second squared — so over the fortieth of a second a torpedo spends
 * crossing its standoff, the well adds well under a unit per second to whatever
 * the check arranged. That matters here more than anywhere else: the two scatter
 * items read a VELOCITY the detonation wrote, and the previous version of this
 * case posed its parent rock where the well had moved that velocity substantially
 * over the shots, so the item read a drift gravity had built rather than the one
 * it arranged. Standing far out is half of that repair; reading the PAIR
 * ({@link kickOf}) is the other half, and together they leave nothing of the well
 * in the figure.
 *
 * It is also clear of the star's whole drawn extent (nothing of the star is drawn
 * beyond `180`, `specs/field.md`) and a Large's whole circle is inside the field,
 * so no still this group keeps straddles a seam.
 */
export const QUIET_GROUND: Vec = QUIET_CORNER;

/* -------------------------------------------------------------------------- */
/* Putting a torpedo on a body's doorstep                                     */
/* -------------------------------------------------------------------------- */

/** What a torpedo is flown into: a centre and a collision radius. */
export interface Target {
  x: number;
  y: number;
  radius: number;
}

/**
 * Where a torpedo's centre starts, measured from the target's centre: contact —
 * the sum of the two radii, which is what `specs/collision.md` makes a touch —
 * plus the harness's own `ROUND_STANDOFF`, so the torpedo begins clear of the
 * body's surface and the build's swept pass is what resolves the hit.
 */
export function torpedoReach(radius: number): number {
  return radius + TORPEDO_R + ROUND_STANDOFF;
}

/** One tick of a torpedo's travel, in units. */
export const TORPEDO_TICK_TRAVEL = TORPEDO_SPEED * TICK_DT;

/** A torpedo's launch: a centre, and the heading it will hold. */
export interface Approach {
  x: number;
  y: number;
  heading: number;
}

/**
 * The launch that puts a torpedo on `target`'s doorstep travelling along `heading`.
 *
 * The same properties `aimedRound` gives a bullet, for the same reasons: the whole
 * flight is the standoff, so nothing can happen to the torpedo on the way in; it
 * begins clear of the body's surface, so what resolves the hit is the build's own
 * swept collision pass rather than an overlap the pose created; and it is aimed
 * dead through the centre.
 *
 * `heading` is the caller's, because half of this group's scenarios want a
 * particular line — a horizontal shot the fan's direction can be read against, or
 * one that cannot reach a bystander — and the other half only want the star out of
 * the way, which is {@link inwardHeading}. It carries none of the target's
 * velocity: `specs/weapons.md` gives a torpedo `TORPEDO_SPEED` along its heading
 * and nothing else, so a caller that wants a head-on hit on a drifting body puts
 * the drift along the line rather than leading the shot.
 */
export function approach(target: Target, heading: number): Approach {
  const reach = torpedoReach(target.radius);
  const at = wrapPoint({
    x: target.x - Math.cos(heading) * reach,
    y: target.y - Math.sin(heading) * reach,
  });
  return { x: at.x, y: at.y, heading };
}

/**
 * The heading of an approach that begins on the side of `target` facing AWAY from
 * the star, so the torpedo cannot be absorbed by the core on its way in.
 *
 * `specs/collision.md` removes a torpedo that reaches the core, so a shot fired
 * from the far side across the star lands nothing and would grade the wrong rule.
 * A target standing on the star's own centre has no side facing away from it and
 * is given the `+x` one; nothing in this group poses one there.
 */
export function inwardHeading(target: Vec): number {
  const dx = target.x - STAR.x;
  const dy = target.y - STAR.y;
  if (dx === 0 && dy === 0) return 0;
  return Math.atan2(-dy, -dx);
}

/**
 * One torpedo in flight at a logical field position, on a heading, and its id.
 *
 * The operation is asserted through {@link requireOp} before it is driven:
 * `../surface.ts` declares `addTorpedo` optional only because ONE harness serves
 * both workspaces, and `specs/instrumentation.md` owes it to every `warhead`
 * build. A named failure beats `h.debug.addTorpedo is not a function`, which the
 * runner would report as a build that exposed no debug surface at all.
 *
 * The id comes off the snapshot's last torpedo, which is where an added one lands
 * (`specs/instrumentation.md`, Identity), so a build whose `addTorpedo` appended
 * nothing fails here naming the operation.
 */
export function poseTorpedo(
  h: Harness,
  x: number,
  y: number,
  heading: number,
): number {
  requireOp(h.debug, "addTorpedo")(x, y, heading);
  const torpedoes = torpedoesOf(h.snapshot());
  if (torpedoes.length === 0) {
    fail(
      `addTorpedo(${String(x)}, ${String(y)}, ${String(heading)}) to append a ` +
        "torpedo to the roster (specs/instrumentation.md)",
      "the torpedo roster is empty",
    );
  }
  return torpedoes[torpedoes.length - 1].id;
}

/**
 * Shut one torpedo's guidance off, so it holds the heading it was launched on.
 *
 * `specs/instrumentation.md`'s `setTorpedoHoming` gates the acquisition and the
 * turn alone, leaving the travel, the lifetime and the impacts running — so a
 * torpedo posed dead-on at a body it is already aimed through exercises the IMPACT
 * and nothing else. That is this group's requirement; the `torpedo` group owns the
 * guidance, and `instrumentation/torpedo-homing-gate` grades the operation itself.
 */
export function holdItsHeading(h: Harness, id: number): void {
  requireOp(h.debug, "setTorpedoHoming")(id, false);
}

/**
 * Put one torpedo on `target`'s doorstep along `heading`, its guidance shut off
 * by {@link holdItsHeading}, and hand back its id.
 */
export function launchAt(h: Harness, target: Target, heading: number): number {
  const start = approach(target, heading);
  const id = poseTorpedo(h, start.x, start.y, start.heading);
  holdItsHeading(h, id);
  return id;
}

/* -------------------------------------------------------------------------- */
/* Flying it in                                                               */
/* -------------------------------------------------------------------------- */

/** Whether the torpedo with that id is still in the roster. */
function inFlight(snapshot: ShatterSnapshot, id: number): boolean {
  return torpedoesOf(snapshot).some((torpedo) => torpedo.id === id);
}

/** What a torpedo's flight came to, and the two ticks that bracket its end. */
export interface TorpedoRun {
  /** Whether the torpedo left the roster within the sweep. */
  hit: boolean;
  /** Ticks driven to the sample it was gone on. */
  ticks: number;
  /**
   * The state on the last tick it was STILL IN FLIGHT.
   *
   * What a check reads the parent's velocity off, so nothing of what the well was
   * doing to the parent enters a figure the detonation wrote — and what
   * `absorbed-by-the-core` reads the torpedo's last position off, so a check can
   * say WHERE the flight ended and not merely that it did.
   */
  before: ShatterSnapshot;
  /** The state on the tick it LEFT the roster: the instant of the detonation. */
  at: ShatterSnapshot;
}

/** How far a flight is followed before the drive gives up. */
export interface DriveOptions {
  maxTicks?: number;
}

/**
 * Run the real simulation one tick at a time until the torpedo with that id is no
 * longer in flight, and report the tick it went on and the one before it.
 *
 * Every tick, because everything this group reads is read AT the detonation: the
 * rock that came apart, the score it paid, the fragments' velocities before the
 * well has had a chance to move them.
 *
 * A second is the default ceiling. Every flight this group poses is the standoff
 * alone — a couple of ticks — or, for `absorbed-by-the-core`, `200` units at
 * `TORPEDO_SPEED`, some fifty; a second is that with an order of room, and it
 * stays well inside `TORPEDO_LIFE` (`3.5` s) so a lifetime that ran out can never
 * be mistaken for a hit.
 *
 * The torpedo is confirmed present before a tick runs, so a build whose
 * `addTorpedo` appended nothing fails naming what the pose owed rather than
 * reporting a flight that ended immediately.
 */
export async function driveTorpedo(
  h: Harness,
  id: number,
  options: DriveOptions = {},
): Promise<TorpedoRun> {
  const maxTicks = options.maxTicks ?? ticksFor(1);
  let before = h.snapshot();
  if (!inFlight(before, id)) {
    fail(
      `the torpedo ${String(id)} in flight before the drive begins ` +
        "(specs/instrumentation.md, warhead)",
      torpedoesOf(before).map((torpedo) => torpedo.id),
    );
  }
  for (let ticks = 1; ticks <= maxTicks; ticks += 1) {
    await h.advance(1);
    const at = h.snapshot();
    if (!inFlight(at, id)) return { hit: true, ticks, before, at };
    before = at;
  }
  return { hit: false, ticks: maxTicks, before, at: before };
}

/* -------------------------------------------------------------------------- */
/* Taking the same rock with the gun                                          */
/* -------------------------------------------------------------------------- */

/**
 * The ticks one round is given to cross its standoff before the drive gives up.
 *
 * `aimedRound` places a round `ROUND_STANDOFF` (`4`) units off the target's
 * surface closing at `MUZZLE_SPEED` (`520`), which is a tick of travel, and
 * `specs/collision.md` makes collision swept so the contact cannot be stepped
 * over. A quarter of a second is that with two orders of room, so a build whose
 * rounds do not land fails with what the scenario needed named rather than
 * hanging the suite, and a round that MISSED — which would otherwise idle out its
 * `BULLET_LIFE` of `1.5` seconds — is caught here rather than being mistaken for
 * a hit.
 */
const ROUND_FLIGHT_TICKS = ticksFor(0.25);

/** What one aimed round came to. */
interface Shot {
  /** The round left the bullet roster within the window: it landed. */
  spent: boolean;
  /** The rock it was aimed at is no longer on the field. */
  destroyed: boolean;
  /** The state on the tick the round left the roster. */
  at: ShatterSnapshot;
}

/**
 * Place one round on the doorstep of the rock with that id and advance, one tick
 * at a time, until the round is spent.
 *
 * The rock is destroyed by the BUILD's own collision, armor and split code, not
 * by anything here. `aimedRound` is the harness's: the round comes in from the
 * side facing away from the star, so `specs/collision.md`'s absorption at the core
 * cannot take it on the way in, and it carries the target's own velocity, so a
 * drifting rock is struck head-on.
 *
 * ONE TICK AT A TIME, because `harder-scatter` reads the fragments off the
 * snapshot this hands back and that reading has to be the TICK OF THE KILL: under
 * `specs/collision.md` the round is removed on the tick it lands, so the tick it
 * leaves the roster is the tick the rock came apart.
 */
async function shootRock(h: Harness, id: number): Promise<Shot> {
  const target = requireRock(
    h.snapshot(),
    id,
    "the rock a round is placed on the doorstep of",
  );
  const round = aimedRound(target);
  const bullet = poseBullet(h, round.x, round.y, round.vx, round.vy);

  for (let tick = 1; tick <= ROUND_FLIGHT_TICKS; tick += 1) {
    await h.advance(1);
    const at = h.snapshot();
    if (!at.bullets.some((one) => one.id === bullet)) {
      return {
        spent: true,
        destroyed: rockById(at, id) === undefined,
        at,
      };
    }
  }
  const at = h.snapshot();
  return { spent: false, destroyed: rockById(at, id) === undefined, at };
}

/**
 * The most rounds a gun kill is given before the drive fails.
 *
 * A bound on a scenario, not a threshold: `specs/rocks.md` owes a Large
 * `ROCK_HEALTH.large` (`3`) rounds and `armor/health-large-3` is the item that
 * grades the figure, so a build that asks for one more must fail THERE rather
 * than silently changing what `harder-scatter`'s control measured. Eight leaves
 * room for a build that resolves a hit a tick late without letting a build whose
 * rounds do not land spin.
 */
const MAX_GUN_ROUNDS = 8;

/**
 * Take the rock with that id down WITH THE GUN, and answer the state on the tick
 * it came apart.
 *
 * `harder-scatter`'s control, and the only place in this group a bullet is fired.
 * Rounds go in one at a time, each placed on the rock's doorstep and each advanced
 * until it is spent, and the build's own collision, armor and split code is what
 * destroys the rock.
 */
export async function destroyByGun(
  h: Harness,
  id: number,
): Promise<ShatterSnapshot> {
  const target = requireRock(
    h.snapshot(),
    id,
    "the rock the gun is taking down",
  );
  const owed = ROCK_HEALTH[target.size];
  for (let round = 1; round <= MAX_GUN_ROUNDS; round += 1) {
    const shot = await shootRock(h, id);
    if (!shot.spent) {
      fail(
        `round ${String(round)} reaching the rock on whose doorstep it was ` +
          `placed, ${String(ROUND_STANDOFF)} units off its surface closing at ` +
          `MUZZLE_SPEED (${String(MUZZLE_SPEED)}) (specs/collision.md)`,
        "the round was still in flight when the window closed",
      );
    }
    if (shot.destroyed) return shot.at;
  }
  fail(
    `a ${target.size} rock destroyed by at most ${String(MAX_GUN_ROUNDS)} ` +
      `rounds on its doorstep, ${String(owed)} being what its armor owes ` +
      "(specs/rocks.md)",
    `rock ${String(id)} was still on the field after ${String(
      MAX_GUN_ROUNDS,
    )} rounds`,
  );
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
 * splitting rather than crashing the script two lines later.
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

/**
 * Half the difference between two fragments' velocities: the kick one of them
 * took, with the parent's own motion cancelled.
 *
 * READ OFF THE PAIR, which is what makes it honest. `specs/collision.md` gives
 * each fragment the destroyed rock's velocity PLUS a kick, the two kicked to
 * opposite sides, so the difference between the two velocities is twice the kick
 * and the parent's motion — including every unit per second the well added to it —
 * falls out exactly.
 */
export function kickOf(a: RockSnapshot, b: RockSnapshot): Vec {
  return { x: (a.vx - b.vx) / 2, y: (a.vy - b.vy) / 2 };
}

/** The magnitude of a planar vector. */
export function lengthOf(v: Vec): number {
  return Math.hypot(v.x, v.y);
}

/**
 * How far a vector's direction lies from an AXIS, in radians: never more than a
 * quarter turn, because an axis has no sense and either fragment may take either
 * side of it.
 */
export function axisOffsetOf(v: Vec, axis: number): number {
  const heading = Math.atan2(v.y, v.x);
  return Math.min(
    angleBetween(heading, axis),
    angleBetween(heading, axis + Math.PI),
  );
}

/** An angle in radians, read back as degrees — the unit `specs/` states one in. */
export function degrees(radians: number): number {
  return radians / DEG;
}
