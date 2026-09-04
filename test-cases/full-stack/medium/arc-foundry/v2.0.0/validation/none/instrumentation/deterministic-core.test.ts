// instrumentation/deterministic-core — the simulation advances on the elapsed
// time it is handed and on nothing else.
//
// `specs/instrumentation.md` states it as a property of the interval rather than
// of the frame: an interval of simulation time reaches the same state however it
// was divided into frames. So the same second is covered twice, once as a single
// frame and once as sixty, and what the two reach is compared.
//
// WHAT A FAILURE HERE MEANS. A build that moves a unit a fixed step per frame,
// or that reads the wall clock inside its update, plays at a different speed on
// every machine and cannot be graded at all: every duration this project measures
// would be measuring the host. The tolerance is the item's own — a logical unit
// on a body travelling sixty of them a second — because a change in step size
// explains a little drift and nothing more.
//
// TWO THINGS TRAVEL, AND BOTH ARE CHECKED. A unit walks its route under the
// pathfinder, and a projectile flies under its own integration; a build can
// integrate one and step the other.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertLessThan } from "../assert";
import {
  ConstantClock,
  captureReplay,
  createHarness,
  distance,
  openYard,
  parkUnit,
  standComponent,
  type Harness,
} from "../harness";

/** The seed both halves of every comparison run under. */
const SEED = 3;

/** The interval the unit comparison covers, and its two divisions. */
const SECOND_MS = 1000;
const FINE_FRAMES = 60;

/** Where the firing structure stands, and where its target is held. */
const TOWER_AT = { col: 20, row: 10 };
const TARGET_AT = { x: 600, y: 276 };

/** How the projectile comparison is stepped while it waits for a shot. */
const ARM_STEP_SECONDS = 1 / 30;
const ARM_STEPS = 180; // six seconds, against a cadence of one shot every two

/** The interval the projectile comparison covers, and its two divisions. */
const FLIGHT_SECONDS = 0.2;
const FLIGHT_FRAMES = 30;

/** The tolerance the item states: one logical unit. */
const TOLERANCE = 1;

let coarse: Harness;
let fine: Harness;

beforeEach(async () => {
  // One frame a second, and sixty. Both harnesses drive the same build the same
  // way; the size of a frame is the only thing that differs between them.
  coarse = await createHarness({ clock: new ConstantClock(SECOND_MS) });
  fine = await createHarness({
    clock: new ConstantClock(SECOND_MS / FINE_FRAMES),
  });
});

afterEach(async () => {
  await coarse.dispose();
  await fine.dispose();
});

it("covers a second in one frame and in sixty, and reaches the same place", async () => {
  // One walking unit on an otherwise empty yard: nothing fires at it, nothing
  // stands in its way, and its travel is the only thing moving.
  for (const h of [coarse, fine]) {
    await openYard(h, { seed: SEED, wave: 1 });
    await h.debug.spawnUnit("mote");
  }

  const before = {
    coarse: await coarse.snapshot(),
    fine: await fine.snapshot(),
  };

  await coarse.advance(1);
  await captureReplay(fine, "drive", () => fine.advance(FINE_FRAMES));

  const after = {
    coarse: await coarse.snapshot(),
    fine: await fine.snapshot(),
  };

  // The clock moved by the second it was handed, either way.
  assertCloseTo(
    after.coarse.simTime - before.coarse.simTime,
    1,
    6,
    "the simulation clock over one second covered as a single frame",
  );
  assertCloseTo(
    after.fine.simTime - before.fine.simTime,
    1,
    6,
    `the simulation clock over one second covered as ${FINE_FRAMES} frames`,
  );

  // And the unit is in the same place.
  const walkedCoarse = after.coarse.units[0];
  const walkedFine = after.fine.units[0];
  assertEqual(
    walkedCoarse === undefined || walkedFine === undefined,
    false,
    "the released unit still on the yard after the second both halves covered",
  );
  assertLessThan(
    distance(walkedCoarse!, walkedFine!),
    TOLERANCE,
    `the distance between where one frame of a second left the unit ` +
      `(${walkedCoarse!.x.toFixed(2)}, ${walkedCoarse!.y.toFixed(2)}) and ` +
      `where ${FINE_FRAMES} frames of it left the unit ` +
      `(${walkedFine!.x.toFixed(2)}, ${walkedFine!.y.toFixed(2)})`,
  );
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

  await coarse.debug.advance(FLIGHT_SECONDS, 1);
  await fine.debug.advance(FLIGHT_SECONDS, FLIGHT_FRAMES);

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
