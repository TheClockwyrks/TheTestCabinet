// Spectra — screens/howto-returns-selection: leaving how-to lands on its entry.
//
// THE RULE. `specs/ui.md`, on the `howto` screen: "`back` returns to `title`, with
// the title's highlight on `HOW TO PLAY`." The title's own section states the same
// rule generally — "Every later arrival at the title puts the highlight on the title
// entry that led away from it" — and `HOW TO PLAY` is the entry that leads to this
// screen. A player who has just read the how-to and pressed Escape finds the
// highlight where they left it rather than back at the top.
//
// THE GROUND IS POSED, NOT WALKED TO. `reset` leaves the title with the highlight on
// the first item, and `setScreen` puts the game on `howto` from there
// (`specs/instrumentation.md`), so nothing on the way in can fail this point: a build
// whose `confirm` never opened the screen loses `screens/howto-reachable` and still
// gets a fair reading here. The rule the specification states is ABSOLUTE — leaving
// `howto` puts the highlight on `HOW TO PLAY` — so the highlight this reads can only
// have been put there on the way out.
//
// THE INDEX IS THE SPECIFICATION'S. `specs/ui.md` fixes `TITLE_ITEMS` as "The mode
// entry `specs/mode.md` names, then `HOW TO PLAY`, in that order", so `HOW TO PLAY`
// is index `1` under either mode.
//
// EVERY WRONG MODEL READS AS A DIFFERENT INDEX. A build that leaves the highlight
// where `reset` put it, and a build that returns it to the first item, both read `0`;
// only a build that puts it on the entry that led away reads `1`.
//
// WHAT IS NOT ASSERTED. That the press reaches the title at all is
// `screens/howto-returns`'s, and that `Escape` is `back`'s binding is
// `controls/back-escape`'s. This point reads the highlight and nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

/**
 * The title menu's entries, by index.
 *
 * `specs/ui.md` fixes `TITLE_ITEMS` as "The mode entry `specs/mode.md` names,
 * then `HOW TO PLAY`, in that order", so the mode entry is `0` and how-to-play is
 * `1` whichever mode this build ships.
 */
const MODE_ENTRY = 0;
const HOWTO_ENTRY = 1;

/** The key `specs/controls.md` binds `back` to. It is its only binding. */
const BACK_KEY = "Escape";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts the title's highlight on HOW TO PLAY on the way back", async () => {
  await h.debug.reset();
  await h.debug.setScreen("howto");
  await h.advance(1);
  const posed = await h.snapshot();
  assertEqual(
    posed.screen,
    "howto",
    "the game is on the how-to-play screen before the press",
  );
  assertEqual(
    posed.menuIndex,
    MODE_ENTRY,
    "with the title's highlight where a fresh game leaves it, so the index " +
      "read after the press can only have been set on the way out",
  );

  await h.tap(BACK_KEY);
  await captureStill(h, "title");

  const back = await h.snapshot();
  assertEqual(
    back.screen,
    "title",
    "back on the how-to-play screen reaching the title",
  );
  assertEqual(
    back.menuIndex,
    HOWTO_ENTRY,
    "the title's highlight on arriving back from the how-to screen: the entry " +
      "that led away from the title (specs/ui.md)",
  );
});
