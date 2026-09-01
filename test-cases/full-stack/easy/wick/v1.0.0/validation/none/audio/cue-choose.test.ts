// audio/cue-choose — the frame on which Enter accepts an offer plays the choose
// cue.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("Audio"): "`choose` |
// `CUES.choose` | An offer is accepted, with no `menu-confirm` beside it", and
// under the table: "Each is played on the tick its event happens, or on the frame
// for a menu event". specs/ui.md ("Menu navigation") names the acceptance:
// "`confirm` accepts the highlighted item ... an accepted offer plays `choose`
// alone". So the frame whose `confirm` press accepts an offer plays `choose`.
//
// WHY THE OFFER IS ACCEPTED WITH A REAL KEY. specs/controls.md binds `confirm` to
// `Enter`, and specs/instrumentation.md says of the surface's own acceptance,
// `choose(index)`, that it "Sounds nothing" — so the cue can only be reached
// through a key press, dispatched here through Chromium's own input pipeline.
// The tap is down, one frame, up, so exactly one frame carries the press.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing dropped, and no slot held, so nothing else can raise a
// cue on the accepting frame and the pool is every candidate, which fills the
// overlay with offers to accept. One level-up is queued, not two, so the
// acceptance closes the overlay and returns to `playing` rather than opening the
// next overlay and raising `level-up` beside `choose`; the two-overlay route is
// `audio/cue-level-up`'s.
//
// THE TOLERANCE. None: a cue sounded on the frame or it did not, and the frame is
// exact because a tap carries its press on one frame.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { TICK_HZ } from "../constants";
import {
  captureReplay,
  createHarness,
  openLevelUp,
  pressConfirm,
  watchNamedCues,
  type Harness,
} from "../harness";
import { assertHeard, openNight } from "./cues";

/** One level-up queued, so the acceptance closes the overlay. */
const QUEUED = 1;

/** Frames recorded after the acceptance, for the replay. Decides nothing. */
const TRAIL_FRAMES = TICK_HZ / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("plays the choose cue on the frame Enter accepts an offer", async () => {
  await openNight(h);
  const overlay = await openLevelUp(h, QUEUED);
  assertEqual(overlay.screen, "levelup", "the screen the level-up opened");
  assertGreaterThan(
    overlay.run.offers.length,
    0,
    "the offers the overlay presented",
  );

  const cues = await watchNamedCues(h);
  const accepted = await captureReplay(h, "choose", async () => {
    const after = await pressConfirm(h);
    const frame = h.frame();
    await h.step(TRAIL_FRAMES);
    return { after, frame };
  });

  assertEqual(
    accepted.after.run.pendingLevelUps,
    QUEUED - 1,
    "the level-ups queued after the acceptance",
  );
  assertEqual(
    accepted.after.screen,
    "playing",
    "the screen the acceptance returned to",
  );
  assertHeard(
    cues,
    accepted.frame,
    "choose",
    "the choose cues on the frame the offer was accepted",
  );
});
