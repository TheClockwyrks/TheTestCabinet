// quality/fire-rate-flat — a type's cadence is the same at every rung of the ladder.
//
// specs/components.md fixes it in the scaling table: "Fire rate: Flat. A type's
// cadence is the same at every tier." The Emitter is the type that shows it most
// plainly, at `4.5` shots a second in `BASE_STATS`.
//
// Two things are read, because a build can get either wrong on its own: the
// `fireRate` the snapshot reports at both ends of the ladder, and the number of
// shots each end actually launches over a counted interval. The interval is the
// same for both and the target is the same target — one Overload Dynamo, which
// "cannot be killed" (specs/enemies.md), so neither drive can end early with the
// target dead and neither is measuring anything but the cadence. Only the
// structure changes between the two drives.
//
// Shots are counted as distinct projectile identities rather than as impacts,
// because the requirement is about how often a structure FIRES. The samples are
// taken every few frames, which is often enough that no projectile can appear and
// be gone between two of them: a shot at this range is in flight for about
// eighteen frames of the clock this suite drives.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual, assertLessThanOrEqual } from "../assert";
import { baseStat } from "../constants";
import {
  captureReplay,
  createHarness,
  openYard,
  parkUnit,
  standComponent,
  structureById,
  ticks,
  type Harness,
} from "../harness";

/** The anchor both structures stand on, one after the other. */
const ANCHOR = { col: 10, row: 10 };

/** How far the target stands: inside the Scrap Emitter's `88`, so inside every rung. */
const TARGET_RANGE = 80;

/** The counted interval, in seconds of simulation time. */
const SECONDS = 5;

/** Frames between samples: well inside one shot's flight at this range. */
const SAMPLE_FRAMES = 4;

/** The Emitter's cadence, flat across the ladder. */
const FIRE_RATE = baseStat("emitter").fireRate;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * How many distinct projectiles were launched over `seconds` of simulation.
 *
 * A sweep that never succeeds, driven for its samples: `until` hands the
 * predicate the state after every `poll` frames, which watches a value across a
 * drive at one crossing per sample rather than two.
 */
async function countShots(harness: Harness, seconds: number): Promise<number> {
  const seen = new Set<number>();
  await harness.until(
    (s) => {
      for (const projectile of s.projectiles) seen.add(projectile.id);
      return false;
    },
    { maxFrames: ticks(seconds), poll: SAMPLE_FRAMES },
  );
  return seen.size;
}

it("reports and fires one cadence at Scrap and at Tesla-Prime", async () => {
  await openYard(h, { wave: 1 });

  // The target: one Overload Dynamo, held where it stands so both drives measure
  // the same geometry, and unkillable so neither drive can end early.
  const scrap = await standComponent(h, "emitter", 1, ANCHOR.col, ANCHOR.row);
  const centre = structureById(await h.snapshot(), scrap);
  await parkUnit(h, "overload", { x: centre.cx + TARGET_RANGE, y: centre.cy });

  const counted = await captureReplay(h, "cadence", async () => {
    const atScrap = await countShots(h, SECONDS);

    // The same target, the same anchor, the other end of the ladder.
    await h.debug.clearStructures();
    await h.debug.clearProjectiles();
    const teslaprime = await standComponent(
      h,
      "emitter",
      5,
      ANCHOR.col,
      ANCHOR.row,
    );
    const atTeslaPrime = await countShots(h, SECONDS);
    return { atScrap, atTeslaPrime, teslaprime };
  });

  // The reported cadence is the type's, at both ends.
  assertEqual(
    structureById(await h.snapshot(), counted.teslaprime).fireRate,
    FIRE_RATE,
    "the Emitter's reported fire rate at Tesla-Prime (specs/components.md)",
  );
  assertEqual(
    centre.fireRate,
    FIRE_RATE,
    "the Emitter's reported fire rate at Scrap (specs/components.md)",
  );

  // And each end launched the shots that cadence buys over the interval, to
  // within the one shot a drive can start or end in the middle of.
  const expected = FIRE_RATE * SECONDS;
  assertBetween(
    counted.atScrap,
    expected - 1,
    expected + 1,
    `shots a Scrap Emitter launched over ${SECONDS}s at ${FIRE_RATE}/s`,
  );
  assertBetween(
    counted.atTeslaPrime,
    expected - 1,
    expected + 1,
    `shots a Tesla-Prime Emitter launched over ${SECONDS}s at ${FIRE_RATE}/s`,
  );
  assertLessThanOrEqual(
    Math.abs(counted.atScrap - counted.atTeslaPrime),
    1,
    `the two ends of the ladder firing one cadence (Scrap launched ` +
      `${counted.atScrap}, Tesla-Prime ${counted.atTeslaPrime})`,
  );
});
