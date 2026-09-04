// Wick — audio/cue-choose: the frame on which `confirm` accepts an offer plays
// `choose`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/ui.md (Audio): "`choose` | `CUES.choose` | An offer is accepted,
//     with no `menu-confirm` beside it", and "Each is played ... on the frame
//     for a menu event".
//   - specs/ui.md (Menu navigation): "an accepted offer plays `choose` alone".
//   - specs/ui.md (`levelup`): "`confirm` accepts the highlighted offer ...
//     Then, if another level-up is queued, the next overlay opens ...; else
//     `screen = playing`".
//   - specs/controls.md: `confirm` is bound to `Enter` and `Space` and is read
//     as an edge; on `levelup` it "accepts the highlighted offer".
//   - specs/instrumentation.md: a pose "sounds nothing", so the recording holds
//     the acceptance frame's cues alone.
//
// WHAT IS READ. Exactly one `choose` play across the one frame the acceptance
// runs on, with `screen` back on `playing` and no level-up left queued as the
// evidence that an offer really was accepted.
//
// WHY THE NIGHT IS POSED AS IT IS. An isolated night with nothing on the field
// and every driver switch off, and one level-up queued through the surface, so
// the overlay is reached without a gem, a kill, or a menu on the way and the
// only frame recorded is the one that accepts. The offer at `menuIndex` `0` is
// taken as the overlay opened it, so no highlight moves and no `menu-move`
// enters the drive.
//
// TOLERANCE. None. Both readings are counts, and the screen is discrete.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  isolate,
  onCue,
  openLevelUp,
  tap,
  type Harness,
} from "../harness";
import { CONFIRM_KEY, assertPlayed } from "./cues";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays choose once on the frame the offer is accepted", async () => {
  isolate(h);
  const opened = await openLevelUp(h, 1);
  assertEqual(opened.screen, "levelup", "the screen the overlay opened on");
  const cues = onCue(h);

  const after = await captureReplay(h, "choose", () => tap(h, CONFIRM_KEY));

  assertEqual(after.screen, "playing", "the screen after the acceptance");
  assertEqual(
    after.run.pendingLevelUps,
    0,
    "level-ups queued after the acceptance",
  );
  assertPlayed(cues, "choose", 1, "choose cues on the acceptance frame");
});
