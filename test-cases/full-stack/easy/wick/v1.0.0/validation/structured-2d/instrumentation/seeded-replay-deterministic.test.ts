// Wick — instrumentation/seeded-replay-deterministic: two runs from one seed,
// the same operations, and the same ticks report identical `run` and
// `rngState`, spawns and offers included.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, "A
// deterministic core": "Given the same seed, the same sequence of operations,
// and the same number of ticks, the game reaches the same `run` and `rngState`
// every time. `simTime` and `muted` stand outside that". "Seeded randomness":
// every random draw comes from the one generator — "a spawn's angle and type,
// an offer draw, a puddle's landing point, a strike's target".
//
// THE RUN, driven twice. A fresh run from seed 7 with every switch on, so the
// director spawns and the enemies chase; Oil Splash and Spark held and armed,
// so puddles land and strikes target through the generator; a Pin dart in
// flight; four seconds of ticks, in which moths are killed and gems drop; then
// one level-up queued and the tick that opens the overlay, so the offer draw
// is compared too. The whole `run` and `rngState` are compared structurally.
// The replay is the second run's drive.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  advanceTicks,
  armWeapon,
  captureReplay,
  createHarness,
  freshRun,
  holdWeapon,
  openLevelUp,
  placeProjectile,
  type Harness,
  type WickSnapshot,
} from "../harness";

const SEED = 7;
const DRIVE_TICKS = 240;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** One seeded run: the same operations and ticks every time it is called. */
async function seededRun(record: boolean): Promise<WickSnapshot> {
  freshRun(h, SEED);
  const oil = holdWeapon(h, "oil-splash", 2);
  const spark = holdWeapon(h, "spark", 2);
  armWeapon(h, oil);
  armWeapon(h, spark);
  placeProjectile(h, "pin", 0, 0, 600, 0, 1);
  const drive = (): Promise<WickSnapshot> => advanceTicks(h, DRIVE_TICKS);
  const driven = record
    ? await captureReplay(h, "seeded", drive)
    : await drive();
  assertGreaterThan(
    driven.run.enemies.length,
    0,
    "enemies the director spawned",
  );
  return openLevelUp(h, 1);
}

it("reaches the same run and rngState twice from one seed", async () => {
  const first = await seededRun(false);
  const second = await seededRun(true);

  assertEqual(second.screen, "levelup", "screen after the opening tick");
  assertEqual(second.run.tick, first.run.tick, "run.tick of the two runs");
  assertDeepEqual(second.run, first.run, "run of the two seeded runs");
  assertEqual(
    second.rngState,
    first.rngState,
    "rngState of the two seeded runs",
  );
});
