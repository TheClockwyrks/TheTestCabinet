// states/quit-discards-session — after confirm on QUIT, confirming START opens a
// fresh session rather than resuming the discarded one.
//
// specs/screens.md, on `paused`: "`confirm` on `QUIT` discards the session and
// returns to `title`"; on `title`: "`confirm` on `START` starts a fresh session
// and sets `screen` to `playing`", with wave 1 laid out. A fresh session holds
// score 0 and the 3 starting lives specs/scoring.md fixes.
//
// The discarded session is posed to figures a fresh one can never hold — score
// 4321, 1 life, wave 3 — so a build that quietly resumed it is told from one that
// started over. The two confirms ARE this requirement, so both are real key
// presses; `Enter` is the key pressed, deliberately, because `Space` also
// carries `launch`.
//
// EACH HIGHLIGHT IS POSED, NOT WALKED. Which entry a key press moves the
// highlight onto is the controls category's point, and where a menu's highlight
// lands on arrival is `screens/title-from-quit-highlights-start`; a build whose
// only fault is one of those must fail there rather than here. The pause screen
// is likewise entered through the surface, so a broken pause key fails its own
// point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, PAUSE_MENU, START_LIVES, TITLE_MENU } from "../constants";
import {
  captureReplay,
  openHarness,
  poseMenu,
  startFreshSession,
  tap,
  type Harness,
} from "../harness";

/** The key that carries `confirm` alone — `Space` also carries `launch`. */
const CONFIRM = BINDINGS.confirm[1];
/** Entry 1 of the pause menu: QUIT. Entry 0 of the title menu: START. */
const QUIT_ENTRY = PAUSE_MENU.indexOf("QUIT");
const START_ENTRY = TITLE_MENU.indexOf("START");

/** Figures a fresh session can never hold, so a resumption is unmistakable. */
const POSED_SCORE = 4321;
const POSED_LIVES = 1;
const POSED_WAVE = 3;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens a fresh session after confirm on QUIT", async () => {
  await startFreshSession(h);
  await h.debug.setScore(POSED_SCORE);
  await h.debug.setLives(POSED_LIVES);
  await h.debug.setWave(POSED_WAVE);
  const paused = await poseMenu(h, "paused", QUIT_ENTRY);
  assertEqual(paused.menu.index, QUIT_ENTRY, "the highlight on QUIT");

  await captureReplay(h, "quit-restart", async () => {
    await tap(h, CONFIRM);
    assertEqual(
      (await h.snapshot()).screen,
      "title",
      "the title QUIT discards to",
    );
    await h.debug.setMenuIndex(START_ENTRY);
    await tap(h, CONFIRM);
  });

  const fresh = await h.snapshot();
  assertEqual(fresh.screen, "playing", "the session START opens");
  assertEqual(
    fresh.score,
    0,
    "a fresh session's score, not the discarded 4321",
  );
  assertEqual(
    fresh.lives,
    START_LIVES,
    "a fresh session's lives, not the discarded 1",
  );
  assertEqual(fresh.wave, 1, "a fresh session's wave, not the discarded 3");
});
