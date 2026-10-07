// screens/select-back-returns-to-title — `back` leaves the select screen for the
// title.
//
// THE RULE. "`back` returns to the title" (`specs/modes/campaign.md`, The select
// screen), which the Extras take unchanged — "`confirm` and `back` are as
// `specs/modes/campaign.md` states them" (`specs/modes/extras.md`) — and which
// the select row of `specs/controls.md`'s What each screen reads repeats: "`back`
// returns to `title`". `specs/ui.md` adds what the return does NOT cost:
// "Reaching `title` discards nothing: progress, records, and the per-challenge
// machines of `specs/editor.md` are unchanged by the visit", which is its own
// item; this one decides the SCREEN alone.
//
// THE POSE. Both modes, each on a fresh session, on the select screen as arriving
// at it leaves it. Nothing else is posed: away from the editor there is no run
// for `back` to stop and no challenge for it to close, so the press has exactly
// one thing to do.
//
// THE PRESS IS A REAL ONE, through `Escape`, the key `specs/controls.md` binds
// `back` to, and the frame that delivers it.
//
// THE VERDICT. `screen` is `title` after the press, in each mode, and it is read
// against `select` as well so a build that stayed put is reported as staying.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual } from "../assert";
import { MODES } from "../constants";
import {
  backAction,
  captureStill,
  createHarness,
  openSelect,
  openTitle,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title screen on one back press, in both modes", async () => {
  for (const mode of MODES) {
    await openTitle(h);
    await openSelect(h, mode);

    const posed = await h.snapshot();
    assertEqual(
      posed.screen,
      "select",
      `the press under test is made on the ${mode} select screen`,
    );

    const after = await backAction(h);
    await captureStill(h, "title");

    assertNotEqual(
      after.screen,
      "select",
      `back leaves the ${mode} select screen rather than being read as nothing on it`,
    );
    assertEqual(
      after.screen,
      "title",
      `back on the ${mode} select screen returns to the title`,
    );
  }
});
