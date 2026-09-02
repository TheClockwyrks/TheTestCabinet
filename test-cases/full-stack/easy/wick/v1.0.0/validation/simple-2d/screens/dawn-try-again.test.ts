// screens/dawn-try-again — TRY AGAIN on dawn starts a fresh run.
//
// WHAT THIS DECIDES. One thing: `confirm` on the end screen's first item leaves
// the game on `playing` with a fresh run, so a night can be played again
// without passing through the title.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md ("`fallen` and `dawn`"): "`confirm` takes the highlighted item:
//   `TRY AGAIN` starts a fresh run and sets `screen = playing`", with
//   `END_ITEMS` "`TRY AGAIN`, `TITLE`, in that order" and "`menuIndex` is `0`
//   on arriving".
//   specs/ui.md ("A fresh run"): "`LIGHT THE LAMP`, `TRY AGAIN`, and the debug
//   surface's `setScreen("playing")` each begin a fresh run, and whatever the
//   previous run held is discarded", the fields restated as `FRESH_RUN`.
//   specs/controls.md ("Actions and bindings"): `confirm` is `Enter`, `Space`.
//
// THE DRIVE. An isolated `playing` run ended through `setScreen`, which "Ends
// the run exactly as that ending does, the run kept for the end screen to
// report" (specs/instrumentation.md), so the ending's own rules are not on the
// way in and a build whose ending is broken fails the ending's points rather
// than this one. The run is loaded with a clock, kills, and
// a level first, so the fresh run read back is a fact about what `TRY AGAIN`
// built rather than about a run that already held nothing.
//
// WHY THE FRAME IS SHORT. "The frame's update then runs on the screen the edges
// left: a frame whose press enters `playing` ... runs that frame's ticks"
// (specs/controls.md), so a full frame would leave the run one tick old. Half a
// tick delivers the same edge and consumes none, since "A tick is consumed
// while the accumulator is at least `TICK_DT − TICK_EPSILON`"
// (specs/instrumentation.md).
//
// THE TOLERANCE. None: a screen name and the fresh run's stored fields are
// exact figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { END_ITEMS, FRESH_RUN } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  runFields,
  tapWithoutTick,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("starts a fresh run from the dawn screen", async () => {
  isolate(h, { level: 11 });
  h.debug.setTick(6000);
  h.debug.setKills(52);
  h.debug.setScreen("dawn");
  const before = h.snapshot();
  assertEqual(before.screen, "dawn", "the screen Enter is pressed on");
  assertEqual(
    before.menuIndex,
    END_ITEMS.indexOf("TRY AGAIN"),
    "the highlight resting on TRY AGAIN",
  );

  const after = await tapWithoutTick(h, "Enter");
  captureStill(h, "again");

  assertEqual(after.screen, "playing", "the screen Enter left the game on");
  assertDeepEqual(
    runFields(after.run),
    FRESH_RUN,
    "the run TRY AGAIN started, as specs/ui.md's fresh run fixes it",
  );
});
