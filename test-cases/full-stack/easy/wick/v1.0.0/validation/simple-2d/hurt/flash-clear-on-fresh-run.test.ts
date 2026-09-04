// hurt/flash-clear-on-fresh-run — a fresh run starts with no hurt flash, even
// when the run before it ended with one running.
//
// THE RULE, FROM THE SPEC. specs/ui.md ("A fresh run"): "`LIGHT THE LAMP`,
// `TRY AGAIN`, and the debug surface's `setScreen("playing")` each begin a
// fresh run, and whatever the previous run held is discarded. A fresh run has
// the run clock at `0:00`, the lamplighter at the world origin `(0, 0)` with
// `hp = BASE_MAX_HP` (`100`), `facing = "right"`, and `hurtFlash` at `0`".
// specs/world.md ("Contact damage") says the same of it: `hurtFlash` "is `0` on
// the idle run and on a fresh run".
//
// WHY THE RUN BEFORE IT MATTERS. A build that never arms the flash reads `0`
// here whatever it does, so the point ends a run WITH the flash running: the
// value read back is then the fresh run's own rather than a value carried
// through.
//
// THE DRIVE. An isolated night with `enemyContact` the only switch on and one
// rat posed 20 units along +x lands its hit on the first tick, which arms the
// flash. The run is then ended through `setScreen("fallen")`, which "Ends the
// run exactly as that ending does, the run kept for the end screen to report"
// (specs/instrumentation.md), so the ending's own rules are not on the way in
// and the flash the hit armed is still running on the end screen. `confirm` is
// then pressed on `END_ITEMS`' first item: "`menuIndex` is `0` on arriving" and
// "`TRY AGAIN` starts a fresh run and sets `screen = playing`" (specs/ui.md).
//
// WHY THE FRAME IS SHORT. "The frame's update then runs on the screen the edges
// left: a frame whose press enters `playing` ... runs that frame's ticks"
// (specs/controls.md), so a full frame would leave the fresh run one tick old
// and the reading would be a tick of count-down rather than the arrival. Half a
// tick delivers the same edge and consumes none, since "A tick is consumed while
// the accumulator is at least `TICK_DT − TICK_EPSILON`"
// (specs/instrumentation.md).
//
// WHAT IS READ. `run.hurtFlash` on the fresh run TRY AGAIN started, with the
// flash still running on the end screen read first as the premise, and the
// screen read as the premise that TRY AGAIN started a run at all. What else the
// fresh run holds is `screens/fallen-try-again`'s point.
//
// THE TOLERANCE. None: `0` is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { END_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  tapWithoutTick,
  type Harness,
} from "../harness";
import { armFlash } from "./hurt";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads hurtFlash 0 on the run TRY AGAIN starts after a run that was hit", async () => {
  await armFlash(h);
  h.debug.setScreen("fallen");
  const ended = h.snapshot();
  assertEqual(ended.screen, "fallen", "the screen Enter is pressed on");
  assertEqual(
    ended.menuIndex,
    END_ITEMS.indexOf("TRY AGAIN"),
    "the highlight resting on TRY AGAIN",
  );
  assertGreaterThan(
    ended.run.hurtFlash,
    0,
    "hurtFlash on the ended run, the premise that a flash was running",
  );

  const after = await tapWithoutTick(h, "Enter");
  captureStill(h, "fresh");

  assertEqual(after.screen, "playing", "the screen TRY AGAIN left the game on");
  assertEqual(after.run.hurtFlash, 0, "hurtFlash on the run TRY AGAIN started");
});
