// progression/ending-dismissed — the confirm control dismisses an ending to
// the title.
//
// THE SPEC LINE. `specs/progression.md` — "Interludes and endings":
// "dismissing it returns the game to the title screen". `specs/controls.md`
// ("What each screen reads") names the control that does it: "`gameover`,
// `victory` | confirm dismisses the ending, from the keyboard or a primary
// pointer press".
//
// WHAT THIS DECIDES, AND WHAT IT DOES NOT. The transition alone. Each value a
// dismissal restores is a point of its own beside this one, so a build that
// returns to the title carrying the ended run forward fails those and passes
// this. The pointer is the same transition on a different device and is
// `progression/ending-dismissed-pointer`'s point.
//
// THE DRIVE. The ending is posed by `progression/ending.ts` and `pressConfirm`
// is a REAL `Enter` dispatched at the engine's own input seam, so the whole
// path from the device to the title is what runs. The screen is read back
// before the press, so a build that could not be posed onto an ending fails
// here rather than deciding nothing.
//
// THE TOLERANCE. None. A screen name is an exact comparison.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  pressConfirm,
  type Harness,
} from "../harness";
import { SETTLE_TICKS, poseEnding } from "./ending";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title when the confirm control is raised on an ending", async () => {
  const posed = await poseEnding(h);

  const dismissed = await captureReplay(h, "dismissed", async () => {
    const title = await pressConfirm(h);
    await h.step(SETTLE_TICKS);
    return title;
  });

  assertEqual(posed.screen, "gameover", "the screen the press was made from");
  assertEqual(dismissed.screen, "title", "the screen the confirm press left");
});
