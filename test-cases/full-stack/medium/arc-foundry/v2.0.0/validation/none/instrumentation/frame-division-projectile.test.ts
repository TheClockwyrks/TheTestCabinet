// instrumentation/frame-division-projectile — a shot flies the same distance
// however the interval was divided into frames.
//
// `specs/instrumentation.md` states determinism as a property of the interval
// rather than of the frame: "an interval of simulation time reaches the same
// state however it was divided into frames and whatever frame rate produced it".
// So one flight interval is covered twice, once as a single frame and once as
// thirty, and how far the shot travelled either way is compared.
//
// WHAT A FAILURE HERE MEANS. A build that flies a projectile a fixed step per
// frame plays at a different speed on every machine, and every figure this project
// measures about a shot would be measuring the host. The tolerance is the item's
// own, a logical unit, because a change in step size explains a little drift and
// nothing more.
//
// A SEPARATE FACULTY FROM TRAVEL. A unit walks under the pathfinder and a
// projectile flies under its own integration, and a build can integrate one and
// step the other, so `instrumentation/frame-division-movement` decides the first
// and this decides the second.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan } from "../assert";
import {
  captureReplay,
  ConstantClock,
  createHarness,
  distance,
  openYard,
  parkUnit,
  standComponent,
  type Harness,
} from "../harness";

/** The seed both halves of every comparison run under. */
const SEED = 3;

/** Where the firing structure stands, and where its target is held. */
const TOWER_AT = { col: 20, row: 10 };
const TARGET_AT = { x: 600, y: 276 };

/** How the projectile comparison is stepped while it waits for a shot. */
const ARM_STEP_SECONDS = 1 / 30;
const ARM_STEPS = 180; // six seconds, against a cadence of one shot every two

/** The interval the projectile comparison covers, and its two divisions. */
const FLIGHT_SECONDS = 0.2;
const FLIGHT_MS = FLIGHT_SECONDS * 1000;
const FLIGHT_FRAMES = 30;

/** The tolerance the item states: one logical unit. */
const TOLERANCE = 1;

let coarse: Harness;
let fine: Harness;

beforeEach(async () => {
  // The flight interval as ONE frame, and as thirty. Both harnesses drive the same
  // build the same way; the size of a frame is the only thing that differs between
  // them, and the arming below is stepped through the debug surface in both halves
  // so nothing but the flight is divided differently.
  coarse = await createHarness({ clock: new ConstantClock(FLIGHT_MS) });
  fine = await createHarness({
    clock: new ConstantClock(FLIGHT_MS / FLIGHT_FRAMES),
  });
});

afterEach(async () => {
  await coarse.dispose();
  await fine.dispose();
});

it("flies a projectile the same distance however the interval is divided", async () => {
  // A held target that cannot die and does not move, so the shot chasing it flies
  // a fixed line and the comparison reads travel alone.
  const armed: { id: number; x: number; y: number }[] = [];
  for (const h of [coarse, fine]) {
    await openYard(h, { seed: SEED, wave: 1 });
    await standComponent(h, "discharge", 5, TOWER_AT.col, TOWER_AT.row);
    await parkUnit(h, "overload", TARGET_AT);

    // Wait for a shot, in steps of the same size in both halves: the arrangement
    // is identical and only the interval below is divided differently.
    let shot: { id: number; x: number; y: number } | undefined;
    for (let step = 0; step < ARM_STEPS && shot === undefined; step += 1) {
      await h.debug.advance(ARM_STEP_SECONDS, 1);
      const flying = (await h.snapshot()).projectiles[0];
      if (flying !== undefined) {
        shot = { id: flying.id, x: flying.x, y: flying.y };
      }
    }
    assertEqual(
      shot === undefined,
      false,
      "a projectile in flight within six seconds of a Discharge Rig holding a " +
        "target in range at a cadence of one shot every two seconds " +
        "(specs/components.md)",
    );
    armed.push(shot!);
  }

  await coarse.advance(1);
  await captureReplay(fine, "flight", () => fine.advance(FLIGHT_FRAMES));

  const flown: number[] = [];
  for (const [at, h] of [coarse, fine].entries()) {
    const start = armed[at]!;
    const now = (await h.snapshot()).projectiles.find((p) => p.id === start.id);
    assertEqual(
      now === undefined,
      false,
      `the projectile still in flight after ${FLIGHT_SECONDS}s, well short of ` +
        "the range it was fired across",
    );
    flown.push(distance(start, now!));
  }

  assertLessThan(
    Math.abs(flown[0]! - flown[1]!),
    TOLERANCE,
    `the difference between the distance a projectile covered over ` +
      `${FLIGHT_SECONDS}s as one frame (${flown[0]!.toFixed(2)}) and over ` +
      `${FLIGHT_FRAMES} frames (${flown[1]!.toFixed(2)})`,
  );
});
