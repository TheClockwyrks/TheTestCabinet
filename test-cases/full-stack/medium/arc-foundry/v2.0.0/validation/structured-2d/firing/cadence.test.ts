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

import { ConstantClock } from "@clockwyrks/structured-2d";
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
  TICK_HZ,
} from "../harness";
import {
  componentFireRate,
  PROJECTILE_HIT_R,
  PROJECTILE_SPEED,
} from "../constants";

const ANCHOR = { col: 10, row: 10 };

/** Inside the Scrap Capacitor's `100`, and a flight of about a tenth of a second. */
const TARGET_RANGE = 60;

/** The counted interval, in seconds of simulation time. */
const SECONDS = 10;

/**
 * The frame the counted interval is stepped in, in Hz.
 *
 * TWO BOUNDS SET IT, AND BOTH ARE COMPUTED FROM FIGURES THE SPECS STATE.
 *
 * A shot must land where the game says it lands. `specs/components.md` flies a
 * projectile straight at the point it was aimed at, at `PROJECTILE_SPEED`, and
 * lands it "when the projectile comes within `PROJECTILE_HIT_R` of that
 * position": the target here is held still, so the aim point does not move and
 * the flight closes on it monotonically. A step shorter than the full width of
 * that window — `2 * PROJECTILE_HIT_R` — therefore cannot carry a shot from
 * outside the window to outside it in one frame, which makes
 * `PROJECTILE_SPEED / (2 * PROJECTILE_HIT_R)` the floor on the rate.
 *
 * And the step must divide the flight, because what is counted is distinct
 * projectile identities: a shot has to be on the yard at a sample to be counted at
 * all. That is the sampling bound below rather than a bound on the step.
 *
 * `specs/instrumentation.md` fixes no frame size otherwise — an interval of
 * simulation time reaches the same state however it was divided into frames, which
 * `instrumentation/frame-division-movement` and
 * `instrumentation/frame-division-projectile` are the two items that decide — so
 * the interval takes half the project's own frame, which clears the floor with
 * room to spare.
 */
const COUNT_HZ = Math.max(
  TICK_HZ / 2,
  Math.ceil(PROJECTILE_SPEED / (2 * PROJECTILE_HIT_R)),
);

/** How long one shot is in flight at this range, in seconds. */
const FLIGHT_SECONDS = TARGET_RANGE / PROJECTILE_SPEED;

/**
 * Frames between samples: a third of one shot's flight, so no shot can be
 * launched and land between two readings and go uncounted.
 */
const SAMPLE_FRAMES = Math.max(1, Math.floor((FLIGHT_SECONDS / 3) * COUNT_HZ));

/** The Capacitor's cadence, flat across the quality ladder. */
const FIRE_RATE = componentFireRate("capacitor");

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ clock: new ConstantClock(1000 / COUNT_HZ) });
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
      {
        maxFrames: Math.ceil(SECONDS * COUNT_HZ),
        poll: SAMPLE_FRAMES,
      },
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
