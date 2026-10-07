// campaign/select-confirm-refused-on-a-locked-challenge — `confirm` on a locked
// row does nothing at all.
//
// THE RULE. "`confirm` on an unlocked or solved challenge opens it in the editor;
// `confirm` on a locked one does nothing" (`specs/modes/campaign.md`, The select
// screen), where locked is "Not yet reached. Cannot be entered." This point
// decides the REFUSAL: what a locked row's `confirm` leaves behind. The opening of
// an unlocked or a solved row is its own item, and so is what `up`, `down` and
// `back` do.
//
// THE LOCKED ROW IS THE COURSE'S OWN. "Challenge `1` is unlocked from the start.
// Every other challenge begins locked" (`specs/modes/campaign.md`, Progression),
// and a freshly `reset` session is exactly that state — `campaign.unlockedCount`
// rests at `1` (`specs/instrumentation.md`, Snapshot shape). So challenge 2, the
// row at index `1`, is locked without a single figure being posed, and nothing is
// solved that could open it.
//
// THE PRESS IS THE PLAYER'S. "Menus and select lists are worked from the keyboard
// alone, through the registered actions of `specs/controls.md`" (`specs/ui.md`),
// so the check presses the key `confirm` is bound to rather than calling anything
// that stands in for it.
//
// THE VERDICT. "does nothing": the screen is still `select`, `selectIndex` is
// still the locked row, and no challenge is open in the editor — the snapshot
// carries `challenge` as `null` away from it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  openSelect,
  pressAction,
  type Harness,
} from "../harness";

/** Challenge 2's row: the first one "Every other challenge begins locked" covers. */
const LOCKED_ROW = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the screen and the highlight alone when confirm takes a locked row", async () => {
  await h.debug.reset();
  const fresh = await h.snapshot();
  assertGreaterThan(
    fresh.campaign.count,
    LOCKED_ROW,
    "the course holds a challenge 2, which is the locked row this point takes",
  );
  assertEqual(
    fresh.campaign.unlockedCount,
    1,
    "a freshly started session has challenge 1 unlocked and every other " +
      "challenge locked, so challenge 2's row is the locked one",
  );

  await openSelect(h, "campaign");
  await h.debug.setSelectIndex(LOCKED_ROW);
  await h.advance(1);

  await pressAction(h, "confirm");
  await captureStill(h, "refused");

  const after = await h.snapshot();
  assertEqual(
    after.screen,
    "select",
    "confirm on a locked challenge does nothing, so the select screen is still " +
      "the screen showing",
  );
  assertEqual(
    after.selectIndex,
    LOCKED_ROW,
    "the highlight is left where it stood, on the locked row confirm refused",
  );
  assertNull(
    after.challenge,
    "no challenge is open, so the locked row was not entered in the editor",
  );
  assertEqual(
    after.mode,
    "campaign",
    "the refusal leaves the mode the select screen serves alone",
  );
  assertEqual(
    after.campaign.last,
    0,
    "a refused confirm entered nothing, so the row the select screen lands on " +
      "is still challenge 1",
  );
});
