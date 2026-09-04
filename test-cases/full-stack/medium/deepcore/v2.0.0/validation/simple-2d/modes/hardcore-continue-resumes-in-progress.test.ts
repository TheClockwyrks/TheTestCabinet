// modes/hardcore-continue-resumes-in-progress — Hardcore saves, it just does not
// rescue a death.
//
// specs/modes.md, Hardcore: "A Hardcore save still resumes an expedition in
// progress through `CONTINUE`; it cannot rescue a death." So the mode deletes the
// save ON A DEATH without disabling saving: an expedition banked at the pad and
// left through the title comes straight back through the title's `CONTINUE`,
// exactly as a Standard one does.
//
// THE DEATH IS DELIBERATELY ABSENT. `modes/hardcore-deletes-the-save` drives the
// other half; this one never lets the miner die, so what it reads is the save
// working in the mode that is supposed to be unforgiving about it.
//
// ISOLATION. One Hardcore expedition on an empty mine with the slot cleared
// first, the miner standing at the camp where saving is allowed, and a
// distinctive Credits balance so the expedition that comes back is visibly the
// one that was banked.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  drewText,
  type Harness,
} from "../harness";
import {
  bankSave,
  continueFromTitle,
  menuLength,
  openAtCamp,
} from "../save/expedition";

/** The balance the save carries, so the resumed expedition names itself. */
const CREDITS = 5150;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ storage: true });
});

afterEach(() => {
  h?.dispose();
});

it("resumes a banked Hardcore expedition through the title's CONTINUE", async () => {
  await openAtCamp(h, { mode: "hardcore" });
  h.debug.setCredits(CREDITS);
  bankSave(h);

  h.debug.setScreen("title");
  const calls = await h.frameCalls();
  assertEqual(
    drewText(calls, TITLE_ITEMS[0]),
    true,
    "specs/modes.md: a Hardcore save puts CONTINUE on the title",
  );
  assertEqual(
    await menuLength(h),
    TITLE_ITEMS.length,
    "specs/ui.md: the title menu carries CONTINUE while the Hardcore save exists",
  );

  await continueFromTitle(h);
  await h.advance(1);

  const resumed = h.snapshot();
  captureStill(h, "resume");
  assertEqual(
    resumed.screen,
    "in-mine",
    "specs/modes.md: CONTINUE resumes the Hardcore expedition in progress",
  );
  assertEqual(
    resumed.mode,
    "hardcore",
    "specs/modes.md: the resumed expedition is still Hardcore",
  );
  assertEqual(
    resumed.credits,
    CREDITS,
    "specs/expedition.md: the resumed expedition is the one that was banked",
  );
  assertEqual(
    resumed.hasSave,
    true,
    "specs/modes.md: resuming does not spend the save",
  );
});
