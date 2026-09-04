// controls/confirm-space — `Space` pressed on the title menu's first entry starts a
// game.
//
// THE RULE. `specs/controls.md` binds `Space` to the `confirm` action, whose menu
// column reads "Confirm the selection", and to the firing action `a` as well, and
// settles the ambiguity outright: "`Space` likewise drives firing while the game is
// being played and confirms on a screen showing a menu." Confirming is a press
// edge, "once per press", and "confirming takes the highlighted entry".
// `specs/ui.md` puts `PLAY` first in `TITLE_ITEMS` and says it "Opens a new game,
// as `specs/progression.md` states, and moves to `playing`".
//
// THE AMBIGUITY IS THE POINT, AND IT IS WHY THIS IS A SEPARATE ITEM FROM
// `controls/confirm-enter`. `Enter` drives `confirm` and nothing else; `Space`
// drives `confirm`, `a` and — under `base` — `b` all at once, and the engine arms
// an edge on every one of them from the single press. Which of those the build
// answers on the title is entirely the build's to decide by the screen. A build
// that read the press as a shot — the natural fault when the firing branch runs
// before the screen is consulted — leaves the game on the title and fails here
// while passing the `Enter` item, which is exactly the split these two items exist
// to make.
//
// THE KEY IS A REAL ONE. `tap` presses the key, runs the frame that delivers it,
// releases it, and runs one more, all as `KeyboardEvent`-shaped events at the event
// target the engine listens on, which the engine's input contract states drives an
// action exactly as a player's key does. A press is "news for exactly one frame",
// so a build reading the armed edge answers in the first of the two frames and a
// build that latched it answers in the second: both are read.
//
// WHAT THIS ITEM DOES NOT DECIDE. What a NEW GAME is, which is
// `screens/play-starts-a-game`; nor that `Space` FIRES on the field, which is
// `controls/fire-space`. Only that this key, on this screen, takes the highlighted
// entry.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, TITLE_ITEMS } from "../constants";
import { assertContains, assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

/** The key this item decides, and the action `specs/controls.md` binds it to. */
const KEY = "Space";
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

it("starts a game when Space is pressed on the title menu's first entry", async () => {
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
    "the screen Space opened from the title menu's first entry",
  );
});
