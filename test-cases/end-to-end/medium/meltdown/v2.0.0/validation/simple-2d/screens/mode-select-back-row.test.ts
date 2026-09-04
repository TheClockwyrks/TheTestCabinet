// screens/mode-select-back-row — confirming BACK on the mode list returns to
// the title.
//
// THE RULE. `specs/screens.md`, on `modeselect`: the screen "draws the six rows of
// `MODE_ITEMS`: `CONTAINMENT`, `THE HUNDRED`, `DEEP POCKETS`, `BOTTLENECK`,
// `SUDDEN DEATH`, and `BACK`", and the row table sends `BACK` to `title`.
//
// WHY THE ROW EXISTS AND WHY IT IS GRADED. `specs/controls.md` makes every
// interaction reachable with the pointer alone and the game fully playable on a
// touchscreen, so a screen a player can only leave with a key strands a player who
// has no keyboard. The row is the way out that a finger has. That `back` reaches
// the same screen is `screens.back-from-mode-select`'s requirement, and the two
// are separately breakable.
//
// THE ROW IS TAKEN, NOT POSED. Where a row leads is an entry effect, and
// `setScreen` runs none (`specs/instrumentation.md`), so the highlight is put on
// the row and `confirm` is pressed. The highlight is placed with `setMenuIndex`
// rather than walked there, because moving a highlight is `controls.menu-down`'s
// requirement and a longer route here would only make this verdict less precise.
//
// THE LAST ROW, READ OFF THE PROJECT'S OWN TRANSCRIPTION of `MODE_ITEMS`, so the
// row this presses is the row the specification puts `BACK` on rather than an
// index written out here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { MODE_ITEMS, BINDINGS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { poseMenu } from "./menu";

/** The key specs/controls.md binds `confirm` to. */
const CONFIRM = BINDINGS.confirm[0];

/** The row confirmed: `BACK`, the last of the `MODE_ITEMS`. */
const BACK_ROW = MODE_ITEMS.indexOf("BACK");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title when BACK is confirmed", async () => {
  poseMenu(h, "modeselect", BACK_ROW);
  await h.advance(1);

  const before = h.snapshot();
  assertEqual(
    before.screen,
    "modeselect",
    "the screen the row is confirmed on",
  );
  assertEqual(before.menuIndex, BACK_ROW, "the row the confirm is made on");

  await h.tap(CONFIRM);
  captureStill(h, "title");

  const after = h.snapshot();
  assertEqual(
    after.screen,
    "title",
    "the screen confirming the mode list's BACK row leads to",
  );
});
