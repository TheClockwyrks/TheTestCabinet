// states/quit-discards-session — after confirm on QUIT, confirming START
// opens a fresh session rather than resuming the discarded one.
//
// specs/screens.md, on `paused`: "`confirm` on `QUIT` discards the session
// and returns to `title`"; on `title`: "`confirm` on `START` starts a fresh
// session and sets `screen` to `playing`", with wave 1 laid out. A fresh
// session holds score 0 and the 3 starting lives specs/scoring.md fixes.
//
// The discarded session is posed to figures a fresh one can never hold —
// score 4321, 1 life, wave 3 — so a build that quietly resumed it is told
// from one that started over. The QUIT confirm itself IS this requirement, so
// the route runs the real keys over the pause menu (down to QUIT, Enter, then
// Enter again on START); the pause screen is entered through the surface so a
// broken pause key fails its own point, not this one. Enter is the confirm
// key pressed, deliberately, because Space also carries launch.
//
// START IS REACHED BY READING THE HIGHLIGHT, NOT BY ASSUMING IT. specs/screens.md
// has entering `title` highlight entry 0, which is START — but that is
// screens/menu-index-resets-on-entry's point. Here the highlight is read off the
// snapshot on landing and walked to START with the real `down` key, so a build
// whose highlight arrives stale fails its own point rather than this one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan } from "../assert";
import { BINDINGS, START_LIVES, TITLE_ITEMS } from "../constants";
import { captureReplay, openHarness, tap, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens a fresh session after confirm on QUIT", async () => {
  h.reset();
  h.debug.setScreen("playing");
  h.debug.setScore(4321);
  h.debug.setLives(1);
  h.debug.setWave(3);
  h.debug.setScreen("paused");
  assertEqual(h.snapshot().menu.index, 0, "the pause menu opens on RESUME");

  await captureReplay(h, "quit-restart", async () => {
    await tap(h, BINDINGS.down[0]);
    assertEqual(h.snapshot().menu.index, 1, "the highlight moved down to QUIT");
    await tap(h, "Enter");
    assertEqual(h.snapshot().screen, "title", "the title QUIT discards to");
    for (let moves = 0; h.snapshot().menu.index !== 0; moves += 1) {
      assertLessThan(
        moves,
        TITLE_ITEMS.length,
        "down presses spent bringing the title highlight to START",
      );
      await tap(h, BINDINGS.down[0]);
    }
    await tap(h, "Enter");
  });

  const fresh = h.snapshot();
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
