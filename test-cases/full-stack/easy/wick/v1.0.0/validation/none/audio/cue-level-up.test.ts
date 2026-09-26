// audio/cue-level-up — a level-up overlay opening plays the level-up cue, by
// either route it opens.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("Audio"): "`level-up` |
// `CUES.levelUp` | A level-up overlay opens." The two moments an overlay opens
// are both in specs/progression.md: "A `playing` tick that ends with
// `pendingLevelUps` above `0` runs to completion and then opens the overlay:
// `screen` becomes `levelup` with `menuIndex` `0`", and, of an acceptance, "When
// level-ups remain queued the next overlay opens immediately, with a fresh pool
// drawn from the slots as the acceptance left them". So both the tick that opens
// the first overlay and the frame whose `confirm` opens the next are ticks or
// frames that play `level-up`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing dropped, and no slot held, so nothing else on either
// frame can raise a cue and the pool is every candidate, which fills the overlay
// with `OFFER_COUNT` (`3`) offers to accept from. QUEUED (`2`) level-ups are
// posed rather than one, because one is the route where accepting closes the
// overlay instead of opening the next, and the second route is half of this
// point.
//
// WHY THE SECOND OVERLAY IS OPENED WITH A REAL KEY. specs/ui.md ("Menu
// navigation") puts the cue on the acceptance a player makes: "`confirm` accepts
// the highlighted offer", and specs/instrumentation.md says of the surface's own
// acceptance, `choose(index)`, that it "Sounds nothing". So the second route is
// reached by pressing `Enter` through Chromium's own input pipeline, which
// specs/controls.md binds `confirm` to, and never through the surface.
//
// THE ACCEPTING FRAME ALSO PLAYS `choose`. specs/ui.md: "an accepted offer plays
// `choose` alone", beside the `level-up` the next overlay's opening raises, and
// "a tick that raises several different cues plays each of those once". This
// point reads `level-up` on both frames; `choose` is `audio/cue-choose`'s.
//
// THE TOLERANCE. None: a cue sounded on the frame or it did not, and both frames
// are exact — one stepped tick opens the first overlay, and one tapped frame
// carries the press that opens the second.

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

/** Two level-ups queued, so accepting the first opens the second overlay. */
const QUEUED = 2;

/** Frames recorded after the second overlay opens, for the replay. Decides nothing. */
const TRAIL_FRAMES = TICK_HZ / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("plays level-up when the overlay opens and when the next one opens", async () => {
  await openNight(h);

  const cues = await watchNamedCues(h);
  const opened = await captureReplay(h, "levelup", async () => {
    const first = await openLevelUp(h, QUEUED);
    const firstFrame = h.frame();
    const second = await pressConfirm(h);
    const secondFrame = h.frame();
    await h.step(TRAIL_FRAMES);
    return { first, firstFrame, second, secondFrame };
  });

  assertEqual(
    opened.first.screen,
    "levelup",
    "the screen the queued level-up opened",
  );
  assertGreaterThan(
    opened.first.run.offers.length,
    0,
    "the offers the first overlay presented",
  );
  assertHeard(
    cues,
    opened.firstFrame,
    "level-up",
    "the level-up cues on the tick the overlay opened",
  );

  assertEqual(
    opened.second.screen,
    "levelup",
    "the screen the acceptance left, with a level-up still queued",
  );
  assertEqual(
    opened.second.run.pendingLevelUps,
    QUEUED - 1,
    "the level-ups queued after the acceptance",
  );
  assertHeard(
    cues,
    opened.secondFrame,
    "level-up",
    "the level-up cues on the frame the next overlay opened",
  );
});
