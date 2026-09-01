// Wick — instrumentation/overlay-read-only: showing the overlay, letting it
// report over 120 ticks of a posed run, and hiding it leaves the game exactly
// as an identical run without it.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// "Diagnostics": "keep every source a pure read, so watching the overlay
// leaves the game as it is"; "A deterministic core": the same seed, the same
// operations, and the same ticks reach the same `run` and `rngState`.
//
// THE TWO RUNS. Each: `reset` from one seed, a fresh run with every switch
// on, Oil Splash and Spark held and armed (both draw from the generator), a
// key tap, 120 ticks, another tap. In the watched run the taps are Backquote,
// showing the panel before the ticks and hiding it after; in the other they
// are a key bound to nothing, so both runs are the same frames. The whole
// snapshots are compared, `simTime` included.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { OVERLAY_TOGGLE_CODE } from "../constants";
import {
  advanceTicks,
  armWeapon,
  captureReplay,
  createHarness,
  freshRun,
  holdWeapon,
  tap,
  type Harness,
  type WickSnapshot,
} from "../harness";

const SEED = 11;
const WATCHED_TICKS = 120;
/** A key the case binds nothing to and the engine does not listen for. */
const IDLE_CODE = "F23";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

async function run(code: string, record: boolean): Promise<WickSnapshot> {
  freshRun(h, SEED);
  armWeapon(h, holdWeapon(h, "oil-splash", 2));
  armWeapon(h, holdWeapon(h, "spark", 2));
  await tap(h, code);
  const drive = (): Promise<WickSnapshot> => advanceTicks(h, WATCHED_TICKS);
  if (record) await captureReplay(h, "watched", drive);
  else await drive();
  return tap(h, code);
}

it("leaves the watched run identical to the unwatched one", async () => {
  const unwatched = await run(IDLE_CODE, false);
  const watched = await run(OVERLAY_TOGGLE_CODE, true);
  assertEqual(watched.run.tick, unwatched.run.tick, "run.tick of the two runs");
  assertDeepEqual(
    watched,
    unwatched,
    "the watched run's snapshot against the unwatched run's",
  );
});
