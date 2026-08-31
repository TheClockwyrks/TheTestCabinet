// controls/confirm-enter — `Enter` pressed on the title menu's first entry starts a
// game.
//
// THE RULE. `specs/controls.md` binds `Enter` to the `confirm` action, whose menu
// column reads "Confirm the selection" and whose playing column is empty, and reads
// confirming as a press edge, "once per press". "Confirming takes the highlighted
// entry, and `specs/ui.md` states each screen's entries and where each leads."
// `specs/ui.md` puts `PLAY` first in `TITLE_ITEMS` and says it "Opens a new game,
// as `specs/progression.md` states, and moves to `playing`", with "the highlight
// rests on the first entry" on arriving at the title.
//
// THE ROUTE IS THE TITLE, BECAUSE THAT IS THE ONE SCREEN THE GAME OPENS ON.
// `reset()` restores `screen` to `title` and `menuIndex` to `0`
// (`specs/instrumentation.md`), which is the arrangement the item's own description
// names: the title menu, on its first entry. The highlight is then posed at `0`
// explicitly rather than left to the reset, so the check states its own
// precondition and a reader does not have to hold the reset's table in mind.
//
// THE KEY IS A REAL ONE. `tap` presses the key, runs the frame that delivers it,
// releases it, and runs one more, all as `KeyboardEvent`-shaped events at the event
// target the engine listens on, which the engine's input contract states drives an
// action exactly as a player's key does. That contract also makes a press "news for
// exactly one frame", so a build reading the armed edge answers in the first of the
// two frames and a build that latched it answers in the second: both are read.
// `specs/instrumentation.md` gives the debug surface no keyboard operation at all,
// and nothing here poses the screen it is looking for — `setScreen("playing")`
// would answer the question for the build.
//
// WHAT THIS ITEM DOES NOT DECIDE. What a NEW GAME is — its lives, its score, its
// wave and its opening rocks are `screens/play-starts-a-game`'s, and asserting them
// here would cost one build two points for one fault. Nor where the menu's SECOND
// entry leads, which is `screens/howto-reachable`. Only that this key, on this
// screen, takes the highlighted entry.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, TITLE_ITEMS } from "../../src/constants";
import { assertContains, assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

/** The key this item decides, and the action `specs/controls.md` binds it to. */
const KEY = "Enter";
const ACTION = "confirm";

/** The title menu's first entry, `PLAY` (`specs/ui.md`). */
const PLAY_ENTRY = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("starts a game when Enter is pressed on the title menu's first entry", async () => {
  assertContains(
    BINDINGS[ACTION].keys,
    KEY,
    "the keys specs/controls.md binds the `confirm` action to",
  );
  assertEqual(
    TITLE_ITEMS[PLAY_ENTRY],
    "PLAY",
    "the title menu's first entry, which specs/ui.md fixes",
  );

  h.debug.reset();
  h.debug.setMenuIndex(PLAY_ENTRY);

  const posed = h.snapshot();
  assertEqual(posed.screen, "title", "the screen reset left the game on");
  assertEqual(
    posed.menuIndex,
    PLAY_ENTRY,
    "the entry the highlight was posed on",
  );

  await h.tap(KEY);
  captureStill(h, "confirmed");

  assertEqual(
    h.snapshot().screen,
    "playing",
    "the screen Enter opened from the title menu's first entry",
  );
});
