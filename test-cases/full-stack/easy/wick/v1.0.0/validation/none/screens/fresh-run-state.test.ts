// screens/fresh-run-state — a run started from the title stands at the state
// specs/ui.md fixes for a fresh run.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("A fresh run"): "`LIGHT THE
// LAMP`, `TRY AGAIN`, and the debug surface's `setScreen("playing")` each begin
// a fresh run ... A fresh run has the run clock at `0:00`, the lamplighter at
// the world origin `(0, 0)` with `hp = BASE_MAX_HP` (`100`) and
// `facing = "right"`, level `1` with `xp = 0` and `kills = 0`, Taper at level
// `1` alone in the first weapon slot and no passive held, no enemy, projectile,
// zone, gem, or pickup in the world, no level-up queued, and the spawn timer at
// `0`". specs/instrumentation.md (`setScreen`) states the same as "the idle run
// with Taper at level `1` and cooldown `0` in the first weapon slot", and
// specs/state.md's idle run supplies the rest, which `idleRun([FRESH_TAPER])`
// restates with the derived fields each formula gives a loadout of Taper alone.
//
// WHY THE WORLD IS POSED AS IT IS. Nothing is posed: the run is started the way
// a player starts one, by confirming the highlighted `LIGHT THE LAMP` on the
// title the harness's opening reset leaves. What the check has to arrange is
// the FRAME, not the world. specs/controls.md: a frame's press edges are read
// against the screen it began on and "The frame's update then runs on the
// screen the edges left", so a frame of `TICK_DT` that lights the lamp also
// runs the run's first tick, and the state a fresh run STARTS at would already
// be one tick old. So the press is made across a frame of `SUB_TICK` seconds
// through `advance`, which "Runs one frame of the build's loop worth `seconds`
// of delta time ... exactly as a wall-clock frame of that length": the edge is
// read, the run begins, and the frame consumes no whole tick. The key is a
// dispatched `Enter` raised inside the same evaluation as the call, because the
// build's own loop keeps running frames in real time while the clock is held
// and would otherwise read the press edge first.
//
// THE TOLERANCE. None: every figure of a fresh run is exact, and the comparison
// is against the whole documented run rather than a chosen few fields, so a
// build that left one of the previous session's fields standing fails.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import {
  bracket,
  captureStill,
  createHarness,
  documentedRun,
  FRESH_TAPER,
  idleRun,
  type Harness,
} from "../harness";
import { SUB_TICK } from "./stage";

/** The key that confirms: the first binding of `confirm` (specs/controls.md). */
const CONFIRM_KEY = BINDINGS.confirm[0]!;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("begins the run at tick 0 with Taper alone and nothing else standing", async () => {
  const title = await h.snapshot();
  assertEqual(title.screen, "title", "the screen the press is made on");
  assertEqual(title.menuIndex, 0, "the highlighted item, LIGHT THE LAMP");

  const { after: fresh } = await bracket(h, "advance", [SUB_TICK], {
    hold: CONFIRM_KEY,
  });
  await captureStill(h, "fresh");

  assertEqual(fresh.screen, "playing", "the screen the confirm left");
  assertDeepEqual(
    documentedRun(fresh.run),
    idleRun([FRESH_TAPER]),
    "the run LIGHT THE LAMP begins",
  );
});
