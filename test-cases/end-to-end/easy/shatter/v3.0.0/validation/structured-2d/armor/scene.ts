// Shatter — the placements and the compounds the `armor` checks share.
// CASE-PROVIDED.
//
// This group decides one rule and its consequences: under `warhead` a rock carries
// health, a bullet takes exactly one off it, and only the hit that takes it to `0`
// destroys the rock (`specs/rocks.md`, Armor). Three shapes recur across the
// thirteen checks — a rock posed at a health, a single round placed on its doorstep
// and followed to the tick its hit lands, and a rock slung into the star and read on
// the tick it re-entered — so each is built once, here, rather than thirteen times
// over in checks that would drift apart.
//
// IT LIVES IN THE GROUP RATHER THAN IN `../harness.ts` because nothing outside
// `armor` poses any of them: the harness owns what the whole project shares
// (`aimedRound`, `poseRock`, `startPlaying`, `shootFieldDown`), and this owns what
// this group shares. `setRockHealth` and `rocks[].health` are `warhead`-only, so a
// helper that reaches for either belongs where only a `warhead` checklist loads it.
//
// NOT ONE FIGURE BELOW IS A BOUND. Everything here is geometry and patience — a
// position, a run-in, how long a round is given to cross four units, how big a jump
// can only be a re-placement — and every tolerance stays in the check that asserts
// it, derived there from the figure `specs/` fixes for it.

import { ROCK_RADIUS, STAR_X } from "../constants";
import { fail } from "../assert";
import { QUIET_CORNER } from "../fixtures";
import { directDistance, STAR, wrappedDistance, type Vec } from "../geometry";
import {
  aimedRound,
  poseBullet,
  poseRock,
  requireRock,
  rockById,
  ticksFor,
  ROUND_STANDOFF,
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
 * Where every armor scenario stands the rock it shoots: `(320, 620)`, the
 * harness's own quiet ground.
 *
 * `412` units from the star, where `specs/gravity.md`'s well pulls at about `26`
 * units per second squared — so over the hundredth of a second a round spends
 * crossing its standoff the well adds a quarter of a unit per second to anything a
 * check arranged, and over the whole of a three-round kill it slides the rock a
 * couple of units. Nothing in this group reads a velocity the split wrote, so the
 * well is a nuisance here rather than a confound; standing far out is what keeps it
 * from becoming one.
 *
 * It is also clear of the star's whole drawn extent (nothing of the star is drawn
 * beyond `180`, `specs/field.md`), clear of the HUD, which `specs/ui.md` puts in
 * the upper portion of the field, clear of the ship's safe point at `(640, 560)`,
 * and a Large's whole circle is inside the field, so nothing a still shows
 * straddles a seam.
 */
export const ARMOR_GROUND: Vec = QUIET_CORNER;

/* -------------------------------------------------------------------------- */
/* Reading and posing a rock's health                                         */
/* -------------------------------------------------------------------------- */

/**
 * The hits a rock has left, hard-asserted before it is read.
 *
 * `specs/instrumentation.md`'s Snapshot shape gives every rock a `health` under
 * `warhead`, and the field is optional on `../surface.ts` only because ONE harness
 * serves both workspaces. A check that dereferenced it and got `undefined` would
 * assert `undefined` against a number and report a build that omitted the field as
 * one that got the armor arithmetic wrong; this names the field the build owes.
 */
export function healthOf(rock: RockSnapshot, scenario: string): number {
  if (typeof rock.health !== "number") {
    fail(
      `${scenario}: rock ${rock.id} to report a numeric health, the hits it ` +
        "has left (specs/instrumentation.md, Snapshot shape)",
      rock.health === undefined ? "undefined" : typeof rock.health,
    );
  }
  return rock.health;
}

/**
 * A rock posed at a health, through the surface's own `setRockHealth`.
 *
 * Hard-asserted through {@link requireOp}, so a `warhead` build that never shipped
 * the operation fails naming it rather than crashing the script on a `TypeError` —
 * which the runner would report as a build that failed to expose its debug surface
 * at all, a different and much worse verdict than the true one.
 */
export function poseHealth(h: Harness, id: number, hp: number): void {
  requireOp(h.debug, "setRockHealth")(id, hp);
}

/** The rock with that id, or `undefined` once the roster no longer holds it. */
export function findRock(
  snapshot: ShatterSnapshot,
  id: number,
): RockSnapshot | undefined {
  return rockById(snapshot, id);
}

/** Every rock on the field of one size, in roster order. */
export function rocksOfSize(
  snapshot: ShatterSnapshot,
  size: RockSize,
): RockSnapshot[] {
  return snapshot.rocks.filter((rock) => rock.size === size);
}

/* -------------------------------------------------------------------------- */
/* One round, followed to the tick its hit lands                              */
/* -------------------------------------------------------------------------- */

/**
 * The most ticks one round is given to cross its standoff.
 *
 * `aimedRound` places a round `ROUND_STANDOFF` (`4`) units off the target's surface
 * closing at `MUZZLE_SPEED` (`520`), which is under a tick of travel, and
 * `specs/collision.md` makes collision swept so the contact cannot be stepped over.
 * A quarter of a second is that with two orders of room, so a build whose rounds do
 * not land fails with what the scenario needed named rather than hanging the suite,
 * and a round that MISSED — which would otherwise idle out its `BULLET_LIFE` of
 * `1.5` seconds — is caught here rather than being mistaken for a hit that scored
 * nothing.
 */
const ROUND_FLIGHT_TICKS = ticksFor(0.25);

/** What one round came to: the tick its hit landed, and the tick before it. */
export interface Landing {
  /** The id of the round placed, still in flight in {@link before}. */
  bullet: number;
  /** The state on the last tick before the hit landed. */
  before: ShatterSnapshot;
  /**
   * The state on the tick the hit landed: the tick the struck rock's health
   * first read as anything other than what it read when the round was placed —
   * or, for the fatal hit, the tick the rock left the roster.
   */
  at: ShatterSnapshot;
  /** Ticks advanced between the round being placed and the hit landing. */
  ticks: number;
}

/**
 * Place ONE round on a rock's doorstep and follow it, tick by tick, to the tick its
 * hit lands.
 *
 * THE STOP IS THE ROCK, NEVER THE ROUND. `specs/rocks.md` has a bullet lower the
 * struck rock's health by exactly `1` and be removed, both on the tick it lands, so
 * either would find the same tick on a correct build — but three items in this group
 * are ABOUT what the round did on that tick (`non-fatal-hit-spends-the-bullet` reads
 * the bullet roster there, `non-fatal-hit-does-not-split` the rock count, and
 * `non-fatal-hit-scores-nothing` the score), and a sweep that stopped on the round
 * leaving the roster would be asserting its own stop condition. Watching the health
 * fall — the one thing `specs/rocks.md` says a hit does — leaves each of those three
 * free to say something the drive did not already assume.
 *
 * The round comes in from the side facing away from the star and carries the
 * target's own velocity, both of which are {@link aimedRound}'s: the first so
 * `specs/collision.md`'s absorption at the core cannot take it on the way in, the
 * second so a drifting rock is struck head-on.
 *
 * IT PLACES EXACTLY ONE ROUND. Every check in this group counts hits, so a helper
 * that fired again on a miss would hide the very thing being counted. A caller that
 * wants a rock chipped twice calls this twice.
 */
export async function chipRock(h: Harness, rockId: number): Promise<Landing> {
  const scenario = "the rock a round is placed on the doorstep of";
  const standing = requireRock(h.snapshot(), rockId, scenario);
  const startHealth = healthOf(standing, scenario);
  const round = aimedRound(standing);
  const bullet = poseBullet(h, round.x, round.y, round.vx, round.vy);

  let before = h.snapshot();
  for (let tick = 1; tick <= ROUND_FLIGHT_TICKS; tick += 1) {
    await h.advance(1);
    const at = h.snapshot();
    const now = findRock(at, rockId);
    if (now === undefined || now.health !== startHealth) {
      return { bullet, before, at, ticks: tick };
    }
    before = at;
  }

  const stalled = findRock(h.snapshot(), rockId);
  fail(
    `a round placed ${ROUND_STANDOFF} units off rock ${rockId}'s surface to ` +
      `reach it within ${ROUND_FLIGHT_TICKS} ticks and take one hit off its ` +
      "health (specs/collision.md, specs/rocks.md)",
    stalled === undefined
      ? `rock ${rockId} left the roster without its health ever changing`
      : `its health still reads ${String(stalled.health)}`,
  );
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
 * Geometry: a Large's circle reaches the core at `CORE_R + ROCK_RADIUS.large` (`76`)
 * from the star's centre (`specs/collision.md`), so a rock reading inside `200` has
 * not yet been taken and is a few dozen units from being.
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

/** Drop one rock of `size` straight onto the star at `speed`, and answer its id. */
export function dropOntoTheStar(
  h: Harness,
  size: RockSize,
  speed: number = FALL_SPEED,
): number {
  return poseRock(h, size, FALL_FROM.x, FALL_FROM.y, 0, speed);
}

/**
 * Drop the field's one rock onto the star and hand back the tick it re-entered on
 * and the tick before it.
 *
 * The rock is posed straight above the star's centre, so the well's pull is exactly
 * along its fall and the approach is radial: it reaches the core rather than
 * swinging past it. The march inward is skipped four ticks at a time, and the
 * re-placement is then swept one tick at a time, so what a check reads is the state
 * the rock re-entered in and not one the well has had a chance to work on.
 *
 * THE RECYCLE IS FOUND AS A DISCONTINUITY, not as the rock reading far from the
 * star. A build that never recycles at all sends its rock straight through the core
 * and out the far side, where it reads exactly as far out as a re-placed one — so a
 * sweep watching a distance would report a recycle that never happened and both
 * recycling items would pass vacuously. A jump of {@link REPLACEMENT_JUMP} units
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
      directDistance(snapshot.rocks[0], STAR) < COMMITTED,
    { maxFrames: ticksFor(6), poll: 4 },
  );
  if (!falling.hit) {
    fail(
      `a rock dropped from y=${FALL_FROM.y} reaching the star inside six ` +
        "seconds (specs/gravity.md)",
      `it is still ${directDistance(
        falling.snapshot.rocks[0] ?? FALL_FROM,
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
      before.rocks[0] ?? FALL_FROM,
      STAR,
    ).toFixed(1)} units from the star, having moved no further than a drift ` +
      "in any tick",
  );
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

/** A Large's whole circle, as the radius a presentation reading boxes it with. */
export const LARGE_R = ROCK_RADIUS.large;
