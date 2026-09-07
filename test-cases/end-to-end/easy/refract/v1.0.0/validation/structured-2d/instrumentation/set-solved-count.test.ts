// Refract — instrumentation/set-solved-count: `setSolvedCount` poses the run's
// boards-solved count alone.
//
// specs/instrumentation.md, `setSolvedCount(count)`: "Sets `state.solvedCount`,
// the boards-solved count of the cascade run, to `count` ... and sets its own
// field alone. `state.tier` is left as it is". The check poses a cascade board,
// reads the whole snapshot, sets the count to 7, and holds the snapshot read
// back against the one it replaced with only `solvedCount` changed. A build
// whose operation also recomputes the tier, clears the board, or moves the
// screen fails on the field it touched.
//
// The two snapshots are read with no frame between them, because the pose
// acts on the live state at the call and a frame would move `simTime` and
// refresh the pointer on its own. The frame after the read is what draws the
// evidence. Only the documented fields are compared: a build may hold derived
// fields of its own beside them, and those are its to change.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { GEO_3X3 } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  resetTo,
  type Harness,
} from "../harness";
import { documented } from "./fields";

const POSED_COUNT = 7;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets solvedCount to 7 and leaves every other field as it was", async () => {
  await resetTo(h);
  h.debug.setMode("cascade");
  await loadBoard(h, GEO_3X3);
  const before = h.snapshot();
  assertEqual(
    before.screen,
    "playing",
    "precondition: a cascade board in play",
  );

  h.debug.setSolvedCount(POSED_COUNT);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "posed");

  assertEqual(after.solvedCount, POSED_COUNT, "solvedCount as posed");
  assertDeepEqual(
    documented(after),
    documented({ ...before, solvedCount: POSED_COUNT }),
    "every other documented field as it was (specs/instrumentation.md: " +
      "sets its own field alone)",
  );
});
