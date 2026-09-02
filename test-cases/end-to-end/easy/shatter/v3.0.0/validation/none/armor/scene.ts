// armor — the two things every check in this group needs and the harness does not
// carry: the place a chipped rock is posed, and the drive that slings one into the
// star.
//
// LOCAL TO THIS GROUP ON PURPOSE. `validation/none/harness.ts` owns the compound
// sequences the whole project shares; what is here is wanted only by the thirteen
// `armor` checks, and keeping it beside them leaves the shared file alone.

import { fail } from "../assert";
import { STAR_X } from "../constants";
import { starDistance, wrappedDistance } from "../geometry";
import {
  centreOf,
  rockById,
  ticksFor,
  type Harness,
  type RockView,
  type ShatterSnapshot,
} from "../harness";

/**
 * Where a rock under test is posed: low and to the left, far from everything.
 *
 * 421 units from the star, where the well pulls at about 25 units per second
 * squared — so a rock left at rest here drifts under a unit over the fifth of a
 * second the longest of these scenarios runs, and nothing a check reads is the
 * environment's doing. It is clear of the star's whole drawn extent (nothing of the
 * star is drawn beyond `180`, `specs/field.md`), clear of the ship's safe point at
 * `(640, 560)`, clear of the upper portion the HUD is drawn in, and a Large's whole
 * circle is inside the field, so no reading of what was painted straddles a seam.
 */
export const CHIP_SPOT = { x: 250, y: 520 } as const;

/**
 * A rock's remaining hits, failing the check when the build reports none.
 *
 * `specs/instrumentation.md` puts `health` on every rock a `warhead` snapshot
 * reports, so a build that omits it is answering wrongly rather than leaving a
 * check undecided — and a check that then read `undefined` would crash the script
 * and be misreported as failing to expose the debug surface. It fails here instead,
 * with the field the specification requires named.
 */
export function healthOf(rock: RockView, scenario: string): number {
  if (typeof rock.health !== "number") {
    fail(
      `${scenario}: a rock reporting its health (specs/instrumentation.md)`,
      rock.health,
    );
  }
  return rock.health;
}

/** Where a rock is dropped from to fall onto the star: straight above it. */
export const FALL_FROM = { x: STAR_X, y: 60 } as const;

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
 * along its fall and the approach is radial: it reaches the core
 * (`ROCK_RADIUS.large + CORE_R` away from the centre, `specs/collision.md`) rather
 * than swinging past it. The march inward is skipped, and the re-placement is then
 * swept one tick at a time, so what a check reads is the state the rock re-entered
 * in and not one the well has had a chance to work on.
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
      `${scenario}: exactly one rock on the field, recycling having changed no count (specs/rocks.md)`,
      `the rock roster holds ${snapshot.rocks.length} rocks`,
    );
  }
  return rock;
}

/** The Large a chipping scenario posed, wherever the roster now holds it. */
export function chippedRock(
  snapshot: ShatterSnapshot,
  id: number,
  scenario: string,
): RockView {
  const rock = rockById(snapshot, id);
  if (rock === undefined) {
    fail(
      `${scenario}: the rock ${id} still standing, a hit that leaves health destroying nothing (specs/rocks.md)`,
      `the rock roster holds ${JSON.stringify(snapshot.rocks.map((r) => r.id))}`,
    );
  }
  return rock;
}
