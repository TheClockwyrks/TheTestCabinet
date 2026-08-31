// armor — the four things the checks in this group need and the shared harness does
// not carry: the place a chipped rock is posed, the one `warhead` pose the surface
// makes optional, the drive that lands one round without killing the rock, and the
// drive that slings a rock into the star.
//
// LOCAL TO THIS GROUP ON PURPOSE. `validation/simple-2d/harness.ts` owns the
// compound sequences the whole project shares, and it can only know the surface
// EVERY variant has. What is here is wanted only by the thirteen `armor` checks —
// which never load against a `base` build — so it lives beside them and leaves the
// shared file alone.

import { ROCK_HEALTH } from "../../src/constants";
import { fail } from "../assert";
import { directDistanceToStar } from "../geometry";
import {
  aimedRound,
  poseBullet,
  rockById,
  ticksFor,
  type Harness,
} from "../harness";
import type { RockSnapshot, ShatterSnapshot } from "../surface";

/**
 * Where a rock under test is posed: low and to the left, far from everything.
 *
 * 421 units from the star, where `specs/gravity.md` pulls at `MU / 421^2` = about
 * 25 units per second squared — so a rock left at rest here drifts under a unit
 * over the fifth of a second the longest of these scenarios runs, and nothing a
 * check reads is the environment's doing. It is clear of the star's whole drawn
 * extent (nothing of the star is drawn beyond `180`, `specs/field.md`), clear of
 * the ship's safe point at `(640, 560)`, and a Large's whole circle is inside the
 * field, so no reading of what was painted straddles a seam.
 */
export const CHIP_SPOT = { x: 250, y: 520 } as const;

/**
 * Pose a rock's remaining hits, failing when the build exposes no such operation.
 *
 * `specs/instrumentation.md` owes a `warhead` build `setRockHealth(id, hp)`, and
 * `surface.ts` declares it optional only because ONE surface serves both variants.
 * A named failure here beats `h.debug.setRockHealth is not a function` several
 * lines later, and `armor/set-rock-health-reads-back` is the item that grades the
 * operation itself — so a build that cannot pose a health fails there by name
 * rather than dragging the two recycling items down with it unexplained.
 */
export function poseHealth(h: Harness, id: number, hp: number): void {
  if (h.debug.setRockHealth === undefined) {
    fail(
      "a setRockHealth operation on the debug surface " +
        "(specs/instrumentation.md, warhead)",
      "undefined",
    );
  }
  h.debug.setRockHealth(id, hp);
}

/**
 * A rock's remaining hits, failing the check when the build reports none.
 *
 * `specs/instrumentation.md` puts `health` on every rock a `warhead` snapshot
 * reports, so a build that omits it is answering wrongly rather than leaving a
 * check undecided — and a check that then read `undefined` would crash the script
 * and be misreported as failing to expose the debug surface (fold-in fix D). It
 * fails here instead, with the field the specification requires named.
 */
export function healthOf(rock: RockSnapshot, scenario: string): number {
  if (typeof rock.health !== "number") {
    fail(
      `${scenario}: a rock reporting its health (specs/instrumentation.md)`,
      rock.health,
    );
  }
  return rock.health;
}

/** The Large a chipping scenario posed, wherever the roster now holds it. */
export function chippedRock(
  snapshot: ShatterSnapshot,
  id: number,
  scenario: string,
): RockSnapshot {
  const rock = snapshot.rocks.find((entry) => entry.id === id);
  if (rock === undefined) {
    fail(
      `${scenario}: the rock ${id} still standing, a hit that leaves health ` +
        `destroying nothing (specs/rocks.md)`,
      snapshot.rocks.map((entry) => entry.id),
    );
  }
  return rock;
}

/* ---- Landing one round that does not kill --------------------------------- */

/**
 * How long a round is followed for before the drive gives up.
 *
 * Its whole flight is the harness's `ROUND_STANDOFF` — under a tenth of a second
 * at `MUZZLE_SPEED` — so a second is a wide margin, and a round that has not landed
 * by then never will. A bound on a flight, not a threshold: nothing a check asserts
 * is read off it.
 */
export const CHIP_FLIGHT_TICKS = ticksFor(1);

/** What one round placed on a rock's doorstep did, and where the sweep stopped. */
export interface ChipResult {
  /** The id the round took. */
  bullet: number;
  /** The rock's health moved, or the rock left the field, inside the window. */
  hit: boolean;
  /** The state on the tick the sweep stopped. */
  snapshot: ShatterSnapshot;
}

/**
 * Place one round on the rock's doorstep and stop on the TICK ITS HEALTH FIRST
 * MOVES.
 *
 * The harness's own `shootRock` stops on the tick the BULLET leaves the roster,
 * which is the same tick — but a check about what the hit did to the bullet cannot
 * find its own reading by searching for it. So the sweep here watches the ROCK, and
 * the bullet roster is read at the tick it stops.
 *
 * The round is placed by {@link aimedRound}: on the side of the rock facing away
 * from the star so the core cannot absorb it on the way in, carrying the rock's own
 * velocity so a drifting rock is not missed. What resolves the hit is the build's
 * own collision pass.
 *
 * The sweep also stops on a rock that LEFT the field, so a build that destroys on
 * the first hit ends the drive rather than running it out, and the check that
 * follows reads its own scenario as unmet.
 */
export async function chipTheRock(h: Harness, id: number): Promise<ChipResult> {
  const target = rockById(h.snapshot(), id, "the rock a round was aimed at");
  const full = ROCK_HEALTH[target.size];
  const round = aimedRound(target);
  const bullet = poseBullet(h, round.x, round.y, round.vx, round.vy);
  const landed = await h.until(
    (snapshot) => {
      const struck = snapshot.rocks.find((entry) => entry.id === id);
      return struck === undefined || (struck.health ?? full) < full;
    },
    { maxFrames: CHIP_FLIGHT_TICKS, poll: 1 },
  );
  return { bullet, hit: landed.hit, snapshot: landed.snapshot };
}

/* ---- Slinging a rock into the star --------------------------------------- */

/** Where a rock is dropped from to fall onto the star: straight above it. */
export const FALL_FROM = { x: 640, y: 60 } as const;

/** The inward speed it is dropped at, so the fall is a second rather than three. */
export const FALL_SPEED = 150;

/** Inside this the rock is committed to the core and only the recycle takes it out. */
const NEAR_STAR = 150;

/**
 * Outside this the rock has been re-placed on an edge.
 *
 * `specs/rocks.md` re-places a recycled rock at a random point on one of the four
 * edges of the field, and the nearest point of any edge to the star's centre is
 * `360` away (the middle of the top or bottom edge), so a rock reading further out
 * than this has been MOVED rather than merely climbed back out of the well.
 */
const OFF_EDGE = 250;

/**
 * Drop the field's one rock onto the star and hand back the state on the tick it
 * re-entered.
 *
 * The rock is posed straight above the star's centre, so the well's pull is exactly
 * along its fall and the approach is radial: it reaches the core
 * (`ROCK_RADIUS.large + CORE_R` away from the centre, `specs/collision.md`) rather
 * than swinging past it. The re-entry is swept a tick at a time, so the velocity a
 * check reads is the one the rock re-entered with.
 *
 * The rock is found in the roster rather than by its id: `specs/rocks.md` makes a
 * recycled rock the same rock relocated and leaves the field's rock count
 * unchanged, but it never says the id is preserved, so a check that followed one
 * would be demanding something the specification does not.
 */
export async function slingIntoTheStar(h: Harness): Promise<ShatterSnapshot> {
  const posed = h.snapshot();
  if (posed.rocks.length !== 1) {
    fail(
      "the star's recycling reached with exactly one rock on the field " +
        "(specs/rocks.md)",
      `the rock roster holds ${posed.rocks.length} rocks`,
    );
  }

  const falling = await h.until(
    (snapshot) => {
      const rock = snapshot.rocks[0];
      return rock !== undefined && directDistanceToStar(rock) < NEAR_STAR;
    },
    { maxFrames: ticksFor(4), poll: 1 },
  );
  if (!falling.hit) {
    fail(
      `a rock dropped from y=${FALL_FROM.y} reaching the star inside four ` +
        "seconds (specs/gravity.md)",
      falling.snapshot.rocks.length === 0
        ? "the rock left the field before it got there"
        : `it was still ${directDistanceToStar(falling.snapshot.rocks[0]).toFixed(1)} units out`,
    );
  }

  const returned = await h.until(
    (snapshot) => {
      const rock = snapshot.rocks[0];
      return rock !== undefined && directDistanceToStar(rock) > OFF_EDGE;
    },
    { maxFrames: ticksFor(2), poll: 1 },
  );
  if (!returned.hit) {
    fail(
      "a rock that reached the core re-placed on an edge of the field " +
        "(specs/rocks.md)",
      returned.snapshot.rocks.length === 0
        ? "the rock was destroyed rather than recycled"
        : `it was still ${directDistanceToStar(returned.snapshot.rocks[0]).toFixed(1)} units from the star`,
    );
  }
  return returned.snapshot;
}

/** The one rock the recycling scenario runs with, failing when it is gone. */
export function theOneRock(
  snapshot: ShatterSnapshot,
  scenario: string,
): RockSnapshot {
  const rock = snapshot.rocks[0];
  if (rock === undefined || snapshot.rocks.length !== 1) {
    fail(
      `${scenario}: exactly one rock on the field, recycling having changed no ` +
        "count (specs/rocks.md)",
      `the rock roster holds ${snapshot.rocks.length} rocks`,
    );
  }
  return rock;
}
