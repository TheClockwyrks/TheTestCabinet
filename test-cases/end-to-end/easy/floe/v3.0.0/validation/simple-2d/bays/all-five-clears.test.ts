// bays/all-five-clears — the hop that fills a level's LAST open bay clears the
// level.
//
// specs/bays.md: "A level is cleared by the hop that fills its last open bay."
// specs/progression.md fixes what that clear is below the final level: "`phase`
// becomes `clearing` for `CLEAR_PAUSE`."
//
// Four bays are posed filled and the fifth is filled by a real hop, which is the
// only arrangement that puts the transition where this point can see it: posing
// the fifth as well would clear nothing (`bays/posed-full-does-not-clear`), and
// hopping all five would spend four crossings deciding nothing this point is
// about.
//
// The open one is bay `2`, the middle of the five, so a build that only notices
// the last bay in its array, or only the first, fills a bay that leaves the level
// running and fails here rather than passing by accident.
//
// The level is `1`, below `TOTAL_LEVELS`, so the clear is a `clearing` hold
// rather than the victory the eighth level ends in — which is
// `progression/victory`'s requirement and not this one. The screen is read
// alongside the phase for exactly that reason: a build that ended the RUN on the
// first level's last bay must fail here.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { BAY_COUNT } from "../constants";
import {
  captureReplay,
  createHarness,
  keyFor,
  startCrossing,
  type Harness,
} from "../harness";
import { poseAtBayMouth } from "./bay-mouth";

/** The one bay left open for the hop. */
const OPEN_BAY = 2;

/** The level the clear is taken on: below `TOTAL_LEVELS`, so it holds rather than wins. */
const LEVEL = 1;

/** Every bay filled, which is what the hop leaves behind. */
const ALL_FILLED: boolean[] = Array.from({ length: BAY_COUNT }, () => true);

/** Frames of the clearing hold recorded after the hop, for the replay alone. */
const AFTER_FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("moves the phase to clearing on the hop that fills the fifth bay", async () => {
  startCrossing(h, LEVEL);
  for (let bay = 0; bay < BAY_COUNT; bay += 1) {
    if (bay !== OPEN_BAY) h.debug.setBay(bay, true);
  }
  poseAtBayMouth(h, OPEN_BAY);

  const posed = h.snapshot();
  assertEqual(posed.phase, "crossing", "four posed bays clear nothing");

  const cleared = await captureReplay(h, "clear", async () => {
    await h.tap(keyFor("up"));
    const landed = h.snapshot();
    await h.advance(AFTER_FRAMES);
    return landed;
  });

  assertDeepEqual(cleared.bays, ALL_FILLED, "the last open bay filled");
  assertEqual(cleared.phase, "clearing", "the level cleared by that hop");
  assertEqual(
    cleared.screen,
    "playing",
    `level ${LEVEL} clears rather than wins`,
  );
});
