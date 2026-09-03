// tape/sim-time-accumulates-every-update — `simTime` rises on every update,
// whatever screen is showing.
//
// `specs/state.md` § The frame: "`simTime`, accumulating every update's delta
// time in seconds, whatever the screen." The last three words are the
// requirement: the clock is the game's own, not the run's, so it climbs on the
// title screen and in the editor exactly as it does under a running tape.
//
// TWO SCREENS, ONE DRIVE EACH, and the same number of frames on both. A frame is
// a real frame wherever it is taken — "Off the run screen nothing ticks, and the
// frame is still real: the input delivered since the last frame is read, the
// camera moves against that elapsed time, and the scene is drawn"
// (`specs/instrumentation.md`) — and each covers `1 / TICK_HZ` seconds, so
// `TICK_HZ` frames are one second of `simTime` on either screen. A build that
// accumulated only while a run was running holds at `0` through both drives; one
// that accumulated only off the title screen holds through the first.
//
// The reading starts from the harness's opening reset, which leaves the title
// screen and `simTime` at `0` (`specs/instrumentation.md`), and the yard is
// emptied on the way to the second drive because nothing in this requirement
// concerns what is standing in it.
//
// The tolerance is one frame's worth of time on each reading: the drive is a
// whole number of frames of a fixed length, so the figure is exact arithmetic,
// and what the tolerance leaves room for is a build that draws or updates once
// more on the way onto a screen.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertEqual } from "../assert";
import { TICK_HZ } from "../constants";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

/** One second of frames, at the fixed length `advance` runs them at. */
const A_SECOND = TICK_HZ;

/** One frame's worth of run clock. */
const TOLERANCE = 1 / TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("climbs a second a second on the title screen and in the editor", async () => {
  const opened = await h.snapshot();
  assertEqual(
    opened.screen,
    "title",
    "the screen the harness's opening reset leaves showing " +
      "(specs/instrumentation.md)",
  );
  assertClose(
    opened.simTime,
    0,
    TOLERANCE,
    "simTime after a reset, which the reset returns to 0 " +
      "(specs/instrumentation.md)",
  );

  await h.advance(A_SECOND);
  const onTitle = await h.snapshot();

  await openSite(h, 0);
  await emptyYard(h);
  await h.advance(A_SECOND);
  const inEditor = await h.snapshot();

  await h.capture("state", "The clock after a second on each of two screens");

  assertClose(
    onTitle.simTime,
    1,
    TOLERANCE,
    `simTime after ${A_SECOND} frames on the title screen, where nothing ` +
      "ticks and the frames are still real (specs/state.md)",
  );
  assertEqual(inEditor.screen, "build", "the screen the second drive ran on");
  assertClose(
    inEditor.simTime,
    2,
    TOLERANCE,
    `simTime after ${A_SECOND} more frames on the build screen: it ` +
      "accumulates every update's delta time whatever the screen " +
      "(specs/state.md)",
  );
});
