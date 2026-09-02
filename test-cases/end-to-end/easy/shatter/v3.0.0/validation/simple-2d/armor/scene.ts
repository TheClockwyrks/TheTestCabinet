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
import { directDistanceToStar, distance } from "../geometry";
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
 * `specs/rocks.md` takes a rock at the core and re-places it at a random point on
 * one of the four edges of the field. The nearest point of any edge to the star's
 * centre is `360` away, and the rock is inside `76` when it is taken, so the
 * shortest wrapped separation between where it was and where it re-appears is at
 * least `284`. A rock still drifting covers at most a handful of units in a tick
 * even after a fall through the well, so nothing but the re-placement can clear
 * this — and measuring it as the SHORTEST WRAPPED separation (`specs/field.md`) is
 * what keeps a rock crossing a seam from reading as one.
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
 * along its fall and the approach is radial: it reaches the core
 * (`ROCK_RADIUS.large + CORE_R` away from the centre, `specs/collision.md`) rather
 * than swinging past it. The march inward is skipped, and the re-placement is then
 * swept one tick at a time, so the state a check reads is the one the rock
 * re-entered in and not one the well has had a chance to work on.
 *
 * THE RECYCLE IS FOUND AS A DISCONTINUITY, not as the rock reading far from the
 * star. A build that never recycles at all sends its rock straight through the core
 * and out the far side, where it reads exactly as far out as a re-placed one — so a
 * sweep watching a distance would report a recycle that never happened and
 * `recycling-preserves-health`, whose reading is the same on a rock nothing touched,
 * would pass vacuously. A jump of {@link REPLACEMENT_JUMP} units inside one tick is
 * the thing itself. This is the same drive `../rocks/scene.ts` runs the five
 * `rocks/recycle-*` checks on, so the two groups decide the star's recycling by one
 * reading rather than two.
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
      `it is still ${directDistanceToStar(
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
      distance(was, now) > REPLACEMENT_JUMP
    ) {
      return { before, at };
    }
    before = at;
  }

  fail(
    "a rock that reached the star's core taken from it and re-placed on an " +
      "edge (specs/rocks.md)",
    `two seconds on it is still ${directDistanceToStar(
      before.rocks[0] ?? FALL_FROM,
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
      `${scenario}: exactly one rock on the field, recycling having changed no ` +
        "count (specs/rocks.md)",
      `the rock roster holds ${snapshot.rocks.length} rocks`,
    );
  }
  return rock;
}
