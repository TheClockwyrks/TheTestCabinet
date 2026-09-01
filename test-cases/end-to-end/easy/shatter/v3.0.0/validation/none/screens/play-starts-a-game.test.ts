// Shatter — screens/play-starts-a-game: confirming the title menu's first entry
// opens a new game.
//
// THE RULE. `specs/ui.md` puts `PLAY` first in `TITLE_ITEMS` and says it "opens a new
// game, as `specs/progression.md` states, and moves to `playing`".
// `specs/progression.md` says what a new game is: "`START_LIVES` (`3`) ships,
// counting the one being flown, a score of `0`, and wave `1`". This item reads the
// three the manifest names — the screen, the ships and the score.
//
// NOTHING HERE IS POSED INTO PLACE. `setScreen("playing")` would answer the question
// for the build, and neither `setLives` nor `setScore` can produce a NEW GAME: they
// set a field. So the route is the game's own — `reset()` to the title, the highlight
// addressed at the first entry, and a real confirm key through Chromium's own input
// pipeline — and what is read afterwards is what the build's own new-game path built.
//
// AND THE TITLE IS POSED WRONG FIRST, WHICH IS WHAT MAKES THE READING DECIDE
// ANYTHING. `reset()` already leaves `score` at `0` and `lives` at `START_LIVES`
// (`specs/instrumentation.md`), so a build whose `PLAY` did nothing but change the
// screen would read a fresh run's own figures back and pass. Posing a score no new
// game holds and one ship in hand separates every wrong model: a build that only
// switched screens keeps both posed figures, a build that reset the score but not
// the ships keeps the posed count, and a build that resumed something keeps both.
//
// THE ENTRY IS ADDRESSED, NOT COUNTED. `setMenuIndex(0)` places the highlight;
// counting presses onto it would grade `controls/menu-down-arrow` a second time. The
// confirm key is pressed for real because `specs/instrumentation.md` carries no
// operation that takes a menu entry.
//
// WHAT THIS ITEM DOES NOT DECIDE. That `Enter` and `Space` are the confirm keys
// (`controls/confirm-enter`, `controls/confirm-space`), that a new game opens on wave
// `1` with its rocks up (`waves/first-wave-rocks` and its siblings), or what the
// second entry does (`screens/howto-reachable`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { assertFreshRun, confirmEntry, reachTitle } from "./screens";

/** The title menu's first entry, `PLAY` (`specs/ui.md`). */
const PLAY_ENTRY = 0;

/** A score no new game holds, posed into the title so a no-op `PLAY` is caught. */
const POSED_SCORE = 4260;

/** Ships in hand no new game holds, posed on the same terms. */
const POSED_LIVES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens a game with three ships and no score when PLAY is confirmed", async () => {
  assertEqual(
    TITLE_ITEMS[PLAY_ENTRY],
    "PLAY",
    "the title menu's first entry, which specs/ui.md fixes",
  );

  await reachTitle(h);
  await h.debug.setScore(POSED_SCORE);
  await h.debug.setLives(POSED_LIVES);
  const posed = await h.snapshot();
  assertEqual(posed.score, POSED_SCORE, "the score the title was left holding");
  assertEqual(posed.lives, POSED_LIVES, "the ships the title was left holding");

  await confirmEntry(h, PLAY_ENTRY);
  await captureStill(h, "opening");

  assertFreshRun(await h.snapshot(), "the confirmed PLAY entry opened");
});
