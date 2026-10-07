// screens/levelup-pause-inert — `pause` does nothing on the level-up overlay.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`levelup`"): "`back` and
// `pause` do nothing here." specs/controls.md ("What each screen reads"), the
// `levelup` row, names `up`, `down`, `confirm` and `mute` alone, and "An action
// a row omits does nothing on that screen"; the same file's action table has
// `pause` "pauses on `playing`; resumes on `paused`" and specs/ui.md ("Menu
// navigation") confirms "`pause` is read on `playing` and `paused` alone".
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with three offers queued
// and the highlight moved off `0` with one `ArrowDown` before the press, so a
// build that answered `KeyP` by reopening or re-entering the overlay is told
// from one that ignored it. The offers and the queued level-up are read back as
// well, since neither may move. The press is a REAL `KeyP` held across exactly
// one frame.
//
// THE TOLERANCE. None: a screen name, an index, and a list of offer ids are
// exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  pressDown,
  pressPause,
  type Harness,
} from "../harness";
import { assertHighlight, night, openOffers } from "./stage";

/** Three candidates of an empty loadout's pool. */
const OFFERS = ["ember", "pin", "wick"] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the overlay, its offers and its highlight where KeyP found them", async () => {
  await night(h);
  await openOffers(h, OFFERS);
  const posed = await pressDown(h);
  assertEqual(
    posed.menuIndex,
    1,
    "menuIndex before the press, posed by one ArrowDown",
  );

  const after = await pressPause(h);
  await captureStill(h, "inert");

  assertHighlight(after, "levelup", 1, "after KeyP on the overlay");
  assertEqual(
    (after.run.offers ?? []).join(","),
    OFFERS.join(","),
    "the offers the overlay lists after KeyP",
  );
  assertEqual(after.run.pendingLevelUps, 1, "the level-ups queued after KeyP");
});
