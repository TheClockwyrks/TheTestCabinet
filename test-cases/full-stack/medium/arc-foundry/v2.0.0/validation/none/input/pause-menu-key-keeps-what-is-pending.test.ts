// input/pause-menu-key-keeps-what-is-pending — `KeyP` opens the menu over a held
// rock, a selection and an open overlay, and resuming hands all three back.
//
// THE REQUIREMENT. `specs/controls.md` separates the two keys the pause menu opens
// on: "`KeyP` fires `pause-menu` alone, so it opens the pause menu whatever is
// pending and leaves the held rock, the selection, and the open overlay exactly as
// they were; resuming hands all three back." It is the half of the rule `Escape` can
// never exercise, because `back` spends the press on the first of those three it
// finds. A build that routed `KeyP` through `back` would put the rock away instead
// of opening the menu, and a build that cleared the yard's state on the way into the
// menu would hand the player back a different game than the one they paused.
//
// HOW IT IS DECIDED. All three are pending at once: a structure is stood and
// selected, an overlay is opened, and the press is pulled so a rock is on the
// cursor. `KeyP` is pressed once, and the screen and all three are read on `paused`.
// It is pressed again, and all three are read back on `playing`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PAUSE_MENU_KEY } from "../constants";
import {
  captureStill,
  createHarness,
  type Harness,
  openYard,
  pressAction,
  standComponent,
} from "../harness";

/** Where the selected structure stands: clear of the chain. */
const ANCHOR = { col: 10, row: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the menu over all three and resumes with all three intact", async () => {
  await openYard(h);
  const id = await standComponent(h, "capacitor", 2, ANCHOR.col, ANCHOR.row);
  await h.debug.select(id);
  await h.debug.setOverlay("combos", true);
  await pressAction(h, "stamp");

  const posed = await h.snapshot();
  assertEqual(
    posed.held.active,
    true,
    "a rock held on the cursor before the key is pressed " +
      "(specs/scrap-press.md)",
  );
  assertEqual(
    posed.selected,
    id,
    "a structure selected as well, so all three of back's first rungs are " +
      "pending (specs/controls.md)",
  );
  assertEqual(
    posed.overlays.combos,
    true,
    "an overlay open as well, so all three of back's first rungs are pending " +
      "(specs/controls.md)",
  );

  await h.tap(PAUSE_MENU_KEY);
  await captureStill(h, "paused");

  const paused = await h.snapshot();
  assertEqual(
    paused.screen,
    "paused",
    `pressing ${PAUSE_MENU_KEY} to open the pause menu whatever is pending, ` +
      "rather than backing out of the first pending thing (specs/controls.md)",
  );
  assertEqual(
    paused.held.active,
    true,
    "the held rock while the pause menu is open, which the key leaves exactly " +
      "as it was (specs/controls.md)",
  );
  assertEqual(
    paused.selected,
    id,
    "the selection while the pause menu is open, which the key leaves exactly " +
      "as it was (specs/controls.md)",
  );
  assertEqual(
    paused.overlays.combos,
    true,
    "the open overlay while the pause menu is open, which the key leaves " +
      "exactly as it was (specs/controls.md)",
  );

  await h.tap(PAUSE_MENU_KEY);
  await captureStill(h, "resumed");

  const resumed = await h.snapshot();
  assertEqual(
    resumed.screen,
    "playing",
    "the screen resuming returns to (specs/ui.md)",
  );
  assertEqual(
    resumed.held.active,
    true,
    "the held rock resuming hands back (specs/controls.md)",
  );
  assertEqual(
    resumed.selected,
    id,
    "the selection resuming hands back (specs/controls.md)",
  );
  assertEqual(
    resumed.overlays.combos,
    true,
    "the open overlay resuming hands back (specs/controls.md)",
  );
});
