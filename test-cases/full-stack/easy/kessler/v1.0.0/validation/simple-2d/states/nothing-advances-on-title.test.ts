// states/nothing-advances-on-title — on the title screen no part of the
// simulation advances however much time passes.
//
// specs/screens.md, "What advances on each screen": `title` — "Nothing." The
// reading is the whole snapshot, compared field for field across two seconds
// of driven time, minus one field: specs/instrumentation.md fixes the
// snapshot's `ticks` as "ticks resolved since the last reset, on every
// screen; frozen screens still count them", so the tick counter is the one
// field a frozen screen moves and it is left out of the comparison.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  advanceTicks,
  captureReplay,
  openHarness,
  type Harness,
} from "../harness";
import { HELD_TICKS, stillSnapshot } from "./still";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the whole simulation on the title screen", async () => {
  h.reset();
  const opened = h.snapshot();
  assertEqual(opened.screen, "title", "the screen the time passes on");

  await captureReplay(h, "title-held", () => advanceTicks(h, HELD_TICKS));

  assertDeepEqual(
    stillSnapshot(h.snapshot()),
    stillSnapshot(opened),
    `every snapshot field but the tick counter, after ${HELD_TICKS} ticks on title`,
  );
});
