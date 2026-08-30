// firing/projectile-speed — a shot leaves the centre and travels at 520 a second.
//
// specs/components.md fixes the flight: "the structure launches a projectile from
// its center at `PROJECTILE_SPEED` (`520`) units per second, which travels toward
// its target's current position each update".
//
// One shot is fired at a held unit near the far edge of a Discharge Rig's radius,
// the longest flight the game has, and the projectile's position is sampled every
// frame across it. Two things are read from those samples.
//
// The ground it covers. The distance between the first and the last sample on
// which the projectile MOVED, over the simulation time between them. The
// specification deliberately fixes no update granularity — an interval "reaches
// the same state however it was divided into frames" — so a build is free to run
// its simulation in whole internal steps, and the sample the check catches a
// movement on can sit up to one frame of this suite's own clock past the update
// that produced it. Over a flight this long that leaves a couple of percent of
// slack, which is what the tolerance allows and no more: a build travelling at
// `400` or at `650` fails it.
//
// Where it started. A shot is only ever observed after the update that launched
// it, so the first sample stands one update's travel out from the centre. That
// travel is measured from the samples themselves rather than assumed, and the
// first position is held within two of them — which admits any update rate and
// still catches a shot launched from a muzzle, a barrel tip, or anywhere else off
// the centre.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual, assertGreaterThan } from "../assert";
import { PROJECTILE_SPEED } from "../constants";
import {
  captureReplay,
  createHarness,
  distance,
  openYard,
  parkUnit,
  standComponent,
  structureById,
  ticks,
  type Harness,
} from "../harness";

const ANCHOR = { col: 10, row: 10 };

/** Just inside a Tesla-Prime Discharge Rig's `192`: the longest flight there is. */
const TARGET_RANGE = 185;

/** How long the shot is waited for and flown, in seconds. */
const PATIENCE = 4;

/** The tolerance on the measured speed, as a fraction. */
const SLACK = 0.05;

/** One sample of the flight. */
interface Sample {
  t: number;
  x: number;
  y: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts at the centre and covers PROJECTILE_SPEED units of ground a second", async () => {
  await openYard(h, { wave: 1 });
  const id = await standComponent(h, "discharge", 5, ANCHOR.col, ANCHOR.row);
  const structure = structureById(await h.snapshot(), id);
  await parkUnit(h, "dynamo", {
    x: structure.cx + TARGET_RANGE,
    y: structure.cy,
  });

  const flight = await captureReplay(h, "flight", async () => {
    const samples: Sample[] = [];
    await h.until(
      (s) => {
        const projectile = s.projectiles[0];
        if (projectile !== undefined) {
          samples.push({ t: s.simTime, x: projectile.x, y: projectile.y });
        }
        // Stop on the frame the shot lands: once it is gone there is nothing
        // left to sample, and a second shot would restart the flight.
        return samples.length > 0 && projectile === undefined;
      },
      { maxFrames: ticks(PATIENCE), poll: 1 },
    );
    return samples;
  });

  assertGreaterThan(flight.length, 4, "samples taken of the shot in flight");

  // The samples on which the shot actually moved.
  const moved: Sample[] = [flight[0]!];
  for (const sample of flight.slice(1)) {
    const previous = moved[moved.length - 1]!;
    if (sample.x !== previous.x || sample.y !== previous.y) moved.push(sample);
  }
  assertGreaterThan(
    moved.length,
    4,
    "samples on which the shot had moved since the one before",
  );

  const first = moved[0]!;
  const last = moved[moved.length - 1]!;
  const covered = distance(first, last);
  const elapsed = last.t - first.t;
  assertGreaterThan(elapsed, 0, "simulation time across the sampled flight");
  const speed = covered / elapsed;
  assertBetween(
    speed,
    PROJECTILE_SPEED * (1 - SLACK),
    PROJECTILE_SPEED * (1 + SLACK),
    `the ground the shot covered per second of simulation time ` +
      `(specs/components.md fixes PROJECTILE_SPEED at ${PROJECTILE_SPEED})`,
  );

  // One update's travel, measured from the flight rather than assumed.
  const step = distance(moved[0]!, moved[1]!);
  assertGreaterThan(step, 0, "the ground one update carried the shot");
  assertBetween(
    distance({ x: structure.cx, y: structure.cy }, first),
    0,
    step * 2,
    `how far from the structure's centre the shot was first seen, in the ` +
      `${step.toFixed(3)} units one update carries it: a shot launched from ` +
      `the centre is within one such step of it (specs/components.md)`,
  );

  // And the flight really was the one shot this check fired.
  assertEqual(
    (await h.snapshot()).projectiles.length,
    0,
    "projectiles left in flight once the shot has landed",
  );
});
