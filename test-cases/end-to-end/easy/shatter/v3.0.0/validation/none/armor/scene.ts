// armor — the two things every check in this group needs and the harness does not
// carry: the place a chipped rock is posed, and the drive that slings one into the
// star.
//
// LOCAL TO THIS GROUP ON PURPOSE. `validation/none/harness.ts` owns the compound
// sequences the whole project shares; what is here is wanted only by the thirteen
// `armor` checks, and keeping it beside them leaves the shared file alone.

import { fail } from "../assert";
import { STAR_X } from "../constants";
import { starDistance } from "../geometry";
import {
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

/** Inside this the rock is committed to the core and only the recycle takes it out. */
const NEAR_STAR = 150;

/**
 * Outside this the rock has been re-placed on an edge.
 *
 * `specs/rocks.md` re-places a recycled rock on one of the four edges of the field,
 * and the nearest point of any edge to the star's centre is `360` away (the middle
 * of the top or bottom edge), so a rock reading further out than this has been
 * moved rather than merely climbed.
 */
const OFF_EDGE = 250;

/**
 * Drop the field's one rock onto the star and hand back the state on the tick it
 * re-entered.
 *
 * The rock is posed straight above the star's centre, so the well's pull is exactly
 * along its fall and the approach is radial: it reaches the core
 * (`ROCK_RADIUS.large + CORE_R` away from the centre, `specs/collision.md`) rather
 * than swinging past it. The march inward is skipped, and the re-entry is swept a
 * tick at a time so the velocity read is the one the rock re-entered with.
 *
 * The rock is found in the roster rather than by its id: `specs/rocks.md` makes a
 * recycled rock the same rock relocated and leaves the field's rock count
 * unchanged, but it never says the id is preserved, so a check that followed one
 * would be demanding something the specification does not.
 */
export async function slingIntoTheStar(h: Harness): Promise<ShatterSnapshot> {
  const posed = await h.snapshot();
  if (posed.rocks.length !== 1) {
    fail(
      "the star's recycling reached with exactly one rock on the field (specs/rocks.md)",
      `the rock roster holds ${posed.rocks.length} rocks`,
    );
  }

  const falling = await h.skipUntil(
    (snapshot) => {
      const rock = snapshot.rocks[0];
      return rock !== undefined && starDistance(rock) < NEAR_STAR;
    },
    { maxTicks: ticksFor(4), poll: 1 },
  );
  if (!falling.hit) {
    fail(
      `a rock dropped from ${FALL_FROM.y} reaching the star inside four seconds (specs/gravity.md)`,
      `it was still ${starDistance(falling.snapshot.rocks[0] ?? FALL_FROM).toFixed(1)} units out`,
    );
  }

  const returned = await h.until(
    (snapshot) => {
      const rock = snapshot.rocks[0];
      return rock !== undefined && starDistance(rock) > OFF_EDGE;
    },
    { maxTicks: ticksFor(2), poll: 1 },
  );
  if (!returned.hit) {
    fail(
      "a rock that reached the core re-placed on an edge of the field (specs/rocks.md)",
      returned.snapshot.rocks.length === 0
        ? "the rock was destroyed rather than recycled"
        : `it was still ${starDistance(returned.snapshot.rocks[0] ?? FALL_FROM).toFixed(1)} units from the star`,
    );
  }
  return returned.snapshot;
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
