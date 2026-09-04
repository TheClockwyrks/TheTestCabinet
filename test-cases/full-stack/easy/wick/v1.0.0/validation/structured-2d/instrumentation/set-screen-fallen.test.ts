// Wick — instrumentation/set-screen-fallen: `setScreen('fallen')` shows the
// fallen screen from `playing` and from `paused` and ends no run: the run
// stands exactly as it did.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setScreen`: "Sets `screen` to `name` ... Nothing else changes: the run, the
// loadout, `offers`, `nextOffers`, `chestResult`, `pendingLevelUps`,
// `rngState`, `simTime`, and the driver switches all stand exactly as they
// were", with `menuIndex` `0`, and "Applies on every screen". "The pose sets
// the screen and nothing else, so a run is never begun, discarded, ended, or
// grown by it": the run is ENDED through the ending rule instead, "the fallen
// ending is `setHp` at `0` and one tick, and the dawn ending is `setTick` at
// `DAWN_TIME × TICK_HZ − 1` (`35999`) and one tick", which is `world/`'s
// point. `specs/state.md`: "The `fallen` and `dawn` screens keep the run that
// just ended, since they report its time, level, and kills."
//
// WHAT IS READ, AND WHY THE WHOLE RUN. The end screens are the two the game
// reaches by ENDING a run, so the reading that matters is that this pose did
// not: the whole `run` before the call is compared with the whole `run` after
// it, `hp`, the clock, the level, the kills, and the field included, from an
// isolated run whose figures are told apart from the idle run's.
//
// THE POSES. Once from `playing` and once from `paused`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  placeEnemy,
  poseScreen,
  type Harness,
} from "../harness";

const POSED_TICK = 1234;
const POSED_LEVEL = 6;
const POSED_KILLS = 17;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** An isolated run whose figures are told from the idle run's. */
function poseRun(): void {
  isolate(h, { level: POSED_LEVEL });
  h.debug.setTick(POSED_TICK);
  h.debug.setKills(POSED_KILLS);
  placeEnemy(h, "moth", 300, 0);
}

it("shows the fallen screen from playing and from paused with the run untouched", async () => {
  for (const from of ["playing", "paused"] as const) {
    poseRun();
    // The run is posed on `playing`, which is where the poses that arrange it
    // apply, and only `paused` is then entered through the surface.
    const before = from === "paused" ? poseScreen(h, "paused") : h.snapshot();
    assertEqual(before.screen, from, "screen before the pose");

    h.debug.setScreen("fallen");
    const after = h.snapshot();
    if (from === "paused") {
      await h.frameDraw();
      captureStill(h, "fallen");
    }

    assertEqual(
      after.screen,
      "fallen",
      `screen after setScreen('fallen') from ${from}`,
    );
    assertEqual(
      after.menuIndex,
      0,
      `menuIndex after setScreen('fallen') from ${from}`,
    );
    assertEqual(
      after.run.tick,
      POSED_TICK,
      `run.tick after the pose from ${from}`,
    );
    assertEqual(
      after.run.level,
      POSED_LEVEL,
      `run.level after the pose from ${from}`,
    );
    assertEqual(
      after.run.kills,
      POSED_KILLS,
      `run.kills after the pose from ${from}`,
    );
    assertDeepEqual(
      after.run,
      before.run,
      `the whole run after setScreen('fallen') from ${from}, against the run before it`,
    );
  }
});
