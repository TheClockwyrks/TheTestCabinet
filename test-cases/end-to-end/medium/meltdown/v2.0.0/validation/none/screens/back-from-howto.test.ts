// Meltdown — screens/back-from-howto: Escape returns from the how-to screen to
// the title.
//
// THE RULE. `specs/screens.md`, on `howto`: "`back` returns to `title`."
// `specs/controls.md` binds `back` to `Escape` and resolves it in order: with
// nothing armed and nothing selected and the screen not `playing`, the case that
// applies is the last — "leave the current screen, as `specs/screens.md` states".
//
// WHY THIS IS ITS OWN ITEM. The how-to screen is a dead end otherwise: it starts
// no run and it shows nothing a player needs to come back to. A build whose
// Escape does nothing here traps a player who opened it, which is a different
// defect from one that traps a player on the mode list
// (`screens.back-from-mode-select`) or the difficulty list
// (`screens.back-from-difficulty-select`).
//
// THE ONE SCREEN WHOSE MENU IS THE BUILD'S OWN. `specs/screens.md` fixes rows for
// every other screen and none for `howto`, so this item never touches the
// highlight: it reads the way back the specification does fix.
//
// NOTHING IS ARMED AND NOTHING IS SELECTED, posed outright, because the first two
// cases of `back` would otherwise take precedence — those are
// `controls.esc-cancels-a-held-placement` and `controls.esc-deselects`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import {
  captureStill,
  createHarness,
  tapAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("returns to the title when Escape is pressed on the how-to screen", async () => {
  const { debug } = h;
  await debug.reset();
  await debug.setArmed(null);
  await debug.setSelected(null);
  await debug.setScreen("howto");
  await h.advance(1);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "howto", "the screen the scenario is posed on");
  assertEqual(posed.build, null, "nothing armed, so back leaves the screen");
  assertEqual(
    posed.selected,
    null,
    "nothing selected, so back leaves the screen",
  );

  await tapAction(h, "back");
  await h.advance(1);
  await captureStill(h, "back");

  const after = await h.snapshot();
  assertEqual(
    after.screen,
    "title",
    `${BINDINGS.back}: the screen the how-to screen's way back leads to`,
  );
});
