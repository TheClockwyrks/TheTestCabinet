// firing/cadence — a structure launches its stated number of shots a second.
//
// specs/components.md fixes the cadence: "A structure fires at its fire rate, in
// shots per second, whenever it has a valid target in range", and `BASE_STATS`
// gives the Capacitor `1.6` shots a second at every tier. The snapshot reports the
// same figure as `fireRate`, so the interval is measured against the figure the
// build itself declares as well as against the table.
//
// The target is one Overload Dynamo, which "cannot be killed" (specs/enemies.md),
// held where it stands. That is what makes a counted interval a measurement of the
// cadence and of nothing else: no kill can interrupt it, no bounty lands in the
// middle of it, and the geometry never changes. Ten seconds is sixteen shots at
// this cadence, so the one shot a drive can begin or end in the middle of is a
// small share of the count.
//
// Shots are counted as distinct projectile identities rather than as impacts,
// because a cadence is about how often a structure FIRES. The samples fall every
// few frames, which is well inside one shot's flight at this range.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  type Harness,
  openYard,
  parkUnit,
  standComponent,
  structureById,
  ticks,
} from "../harness";
import { componentFireRate } from "../constants";

const ANCHOR = { col: 10, row: 10 };

/** Inside the Scrap Capacitor's `100`, and a flight of about fourteen frames. */
const TARGET_RANGE = 60;

/** The counted interval, in seconds of simulation time. */
const SECONDS = 10;

/** Frames between samples, well inside one shot's flight at this range. */
const SAMPLE_FRAMES = 4;

/** The Capacitor's cadence, flat across the quality ladder. */
const FIRE_RATE = componentFireRate("capacitor");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("launches fireRate shots a second over a counted interval", async () => {
  openYard(h, { wave: 1 });
  const id = standComponent(h, "capacitor", 1, ANCHOR.col, ANCHOR.row);
  const structure = structureById(h.snapshot(), id);
  parkUnit(h, "overload", {
    x: structure.cx + TARGET_RANGE,
    y: structure.cy,
  });

  assertEqual(
    structure.fireRate,
    FIRE_RATE,
    "the Capacitor's reported cadence (specs/components.md)",
  );

  const shots = await captureReplay(h, "cadence", async () => {
    const seen = new Set<number>();
    // A sweep that never succeeds, driven for its samples: `until` hands the
    // predicate the state after every `poll` frames, which watches a value
    // across a drive at one crossing per sample rather than two.
    await h.until(
      (s) => {
        for (const projectile of s.projectiles) seen.add(projectile.id);
        return false;
      },
      { maxFrames: ticks(SECONDS), poll: SAMPLE_FRAMES },
    );
    return seen.size;
  });

  const expected = FIRE_RATE * SECONDS;
  assertBetween(
    shots,
    expected - 1,
    expected + 1,
    `shots launched over ${SECONDS}s at ${FIRE_RATE} a second, within the one ` +
      `shot the interval can begin or end in the middle of`,
  );
});
