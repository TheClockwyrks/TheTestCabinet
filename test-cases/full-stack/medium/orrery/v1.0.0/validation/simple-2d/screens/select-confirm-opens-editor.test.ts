// screens/select-confirm-opens-editor — `confirm` on a row the mode will open
// puts the game in the editor.
//
// THE RULE. "`confirm` on an unlocked or solved challenge opens it in the editor"
// (`specs/modes/campaign.md`, The select screen), which the Extras take unchanged
// — "`confirm` and `back` are as `specs/modes/campaign.md` states them", over a
// shelf where "Every challenge is unlocked from the start"
// (`specs/modes/extras.md`). The select row of `specs/controls.md`'s What each
// screen reads says the same: "`confirm` opens the highlighted challenge when the
// mode's progression allows". And what opening one means is fixed by
// `specs/editor.md`: "Opening a challenge from a select screen shows this editor
// with that challenge's tray". This point decides the SCREEN the confirm lands
// on; WHICH challenge it opened is
// `select-confirm-opens-highlighted-challenge`'s, and the refusal on a locked row
// is its own item.
//
// THE POSE. Both modes, each on a fresh session, with the highlight on row `0`.
// That row is unlocked and unsolved in both by specification rather than by
// arrangement: "Challenge `1` is unlocked from the start" in the campaign and
// every Extras row is, while `reset` leaves the session with "nothing ... solved"
// (`specs/instrumentation.md`). Both readings are taken from the snapshot before
// the press, so the row the verdict is about is known to be the row the rule
// covers.
//
// THE VERDICT. `screen` is `editor` after the press, and it is read against
// `select` as well, so a build that ignored the key is reported as ignoring it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertNotEqual,
  assertTrue,
} from "../assert";
import { MODES } from "../constants";
import {
  captureStill,
  createHarness,
  openSelect,
  openTitle,
  pressAction,
  progressOf,
  type Harness,
} from "../harness";

/** The row both modes open from the start, and neither has solved. */
const ROW = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the editor on a confirm over an unlocked, unsolved row, in both modes", async () => {
  for (const mode of MODES) {
    await openTitle(h);
    await openSelect(h, mode);
    await h.debug.setSelectIndex(ROW);

    const posed = await h.snapshot();
    const progress = progressOf(posed, mode);
    assertEqual(
      posed.screen,
      "select",
      `the press under test is made on the ${mode} select screen`,
    );
    assertEqual(
      posed.selectIndex,
      ROW,
      `the ${mode} highlight stands on the row the press is about`,
    );
    assertGreaterThanOrEqual(
      progress.unlockedCount ?? progress.count,
      ROW + 1,
      `the ${mode} row under the highlight is unlocked, which is what confirm ` +
        "needs to open it",
    );
    assertTrue(
      !progress.solved.includes(ROW),
      `the ${mode} row under the highlight is unsolved, which is the row this ` +
        "point is about",
    );

    const after = await pressAction(h, "confirm");
    await captureStill(h, "editor");

    assertNotEqual(
      after.screen,
      "select",
      `confirm on an unlocked ${mode} row is read rather than ignored`,
    );
    assertEqual(
      after.screen,
      "editor",
      `confirm on an unlocked, unsolved ${mode} row opens it in the editor`,
    );
  }
});
