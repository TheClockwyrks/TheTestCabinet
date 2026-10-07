// instrumentation/frame-division-projectile — a projectile flies the same distance
// however the interval is divided into frames.
//
// `specs/instrumentation.md` states it as a property of the interval rather than
// of the frame: an interval of simulation time reaches the same state however it
// was divided into frames. A shot's flight is its own integration — a build can
// integrate a unit's walk correctly and still step a projectile a fixed distance
// per frame — so this is its own point, beside
// `instrumentation/frame-division-movement`.
//
// HOW IT IS DECIDED. A Discharge Rig holds a target that cannot die and does not
// move, so the shot chasing it flies a fixed line. Both halves are armed under the
// SAME step size, so only the interval under test is divided differently, and the
// distance each shot covered over that interval is compared.
//
// The tolerance is the item's own — one logical unit — because a change in step
// size explains a little drift and nothing more.

import { ConstantClock } from "@clockwyrks/simple-2d";
import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan } from "../assert";
import {
  captureReplay,
  createHarness,
  distance,
  openYard,
  parkUnit,
  standComponent,
  type Harness,
} from "../harness";

/** Where the firing structure stands, and where its target is held. */
const TOWER_AT = { col: 20, row: 10 };
const TARGET_AT = { x: 600, y: 276 };

/** How the comparison is stepped while it waits for a shot. */
const ARM_STEP_SECONDS = 1 / 30;
const ARM_STEPS = 180; // six seconds, against a cadence of one shot every two

/** The interval the comparison covers, and its two divisions. */
const FLIGHT_SECONDS = 0.2;
const FLIGHT_FRAMES = 30;

/** The tolerance the item states: one logical unit. */
const TOLERANCE = 1;

let coarse: Harness;
let fine: Harness;

beforeEach(async () => {
  coarse = await createHarness();
  fine = await createHarness();
});

afterEach(() => {
  coarse?.dispose();
  fine?.dispose();
});

it("flies a projectile the same distance however the interval is divided", async () => {
  // A held target that cannot die and does not move, so the shot chasing it flies
  // a fixed line and the comparison reads travel alone.
  const armed: { id: number; x: number; y: number }[] = [];
  for (const h of [coarse, fine]) {
    // The same arming step in both halves: only the interval under test below is
    // divided differently.
    h.engine.setClock(new ConstantClock(ARM_STEP_SECONDS * 1000));
    openYard(h, { wave: 1 });
    standComponent(h, "discharge", 5, TOWER_AT.col, TOWER_AT.row);
    parkUnit(h, "overload", TARGET_AT);

    let shot: { id: number; x: number; y: number } | undefined;
    for (let step = 0; step < ARM_STEPS && shot === undefined; step += 1) {
      await h.advance(1);
      const flying = h.snapshot().projectiles[0];
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

  // The same interval, as one frame and as thirty.
  coarse.engine.setClock(new ConstantClock(FLIGHT_SECONDS * 1000));
  fine.engine.setClock(
    new ConstantClock((FLIGHT_SECONDS * 1000) / FLIGHT_FRAMES),
  );
  await coarse.advance(1);
  await captureReplay(fine, "flight", () => fine.advance(FLIGHT_FRAMES));

  const flown: number[] = [];
  for (const [at, h] of [coarse, fine].entries()) {
    const start = armed[at]!;
    const now = h.snapshot().projectiles.find((p) => p.id === start.id);
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
