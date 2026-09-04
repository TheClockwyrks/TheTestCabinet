// screens/resume-p — the pause key gives a paused game back.
//
// THE RULE. `specs/controls.md` gives the `pause` action two meanings: "Pause"
// while the game is being played, and "Resume the paused game" on a menu.
// `specs/ui.md` says the same from the screen's side: "Leaving this screen and
// pausing again each do what `RESUME` does", and `RESUME` "returns to `playing`
// with the field and the run exactly as they stood".
//
// WHY IT IS A SEPARATE ITEM FROM `controls/pause-p`. Opening the pause menu and
// closing it again are two branches on two screens. A pause menu the key that
// opened it cannot dismiss is the classic half-wired pause, and a build with it
// should lose this point alone rather than the pause point as well.
//
// AND FROM `screens/resume-escape`. `pause` and `back` are two actions and two
// branches; `KeyP` raises `pause` alone, where `Escape` raises both at once.
//
// THE DISTINGUISHING POSE. A build that RESTARTED on the key reaches `playing`
// too, so the screen alone decides nothing. The run carries figures no new game
// has — `POSED_SCORE`, `POSED_LIVES` ships, wave `POSED_WAVE` — and a rock stands
// on the field, so a restart, a quit and a relaid field each read differently.
//
// THE ACTION IS DRIVEN, NOT THE KEY, because which key raises `pause` is
// `controls/pause-p`'s point. `tapAction` presses whichever key the binding table
// gives the action first and grades nothing by it.
//
// WHAT THIS ITEM DOES NOT DECIDE. That the key PAUSES (`controls/pause-p`), that
// the paused field was frozen (`screens/pause-freezes-the-field`), or what the
// menu's `RESUME` entry does (`screens/resume-returns-to-play`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  rockById,
  startPlaying,
  tapAction,
  type Harness,
} from "../harness";

/** A run no new game has, so a build that restarted instead is caught. */
const POSED_SCORE = 4260;
const POSED_LIVES = 2;
const POSED_WAVE = 3;

/** Where the rock on the paused field is posed, and how fast, in logical units. */
const ROCK_SPOT = { x: 300, y: 160 };
const ROCK_DRIFT = 150;

/**
 * How far a body may have moved by the time the resumed field is read, in logical
 * units. Two ticks at `ROCK_DRIFT` is `2.5`; four leaves room for the well's own
 * pull, which at this distance is under a hundredth of a unit over the same span.
 */
const RESUME_SLACK = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives the paused game back when the pause key is pressed", async () => {
  startPlaying(h);
  h.debug.setScore(POSED_SCORE);
  h.debug.setLives(POSED_LIVES);
  h.debug.setWave(POSED_WAVE);
  const rockId = poseRock(h, "small", ROCK_SPOT.x, ROCK_SPOT.y, ROCK_DRIFT, 0);
  h.debug.setScreen("paused");

  const stood = h.snapshot();
  assertEqual(stood.screen, "paused", "the screen the press was made on");

  await tapAction(h, "pause");
  captureStill(h, "resumed");

  const resumed = h.snapshot();
  assertEqual(
    resumed.screen,
    "playing",
    "the screen the pause key gives a paused game (specs/ui.md)",
  );
  assertEqual(
    resumed.score,
    POSED_SCORE,
    "the score the resumed run carries, exactly as it stood (specs/ui.md)",
  );
  assertEqual(
    resumed.lives,
    POSED_LIVES,
    "the ships the resumed run carries, exactly as they stood (specs/ui.md)",
  );
  assertEqual(
    resumed.wave,
    POSED_WAVE,
    "the wave the resumed run is on, exactly as it stood (specs/ui.md)",
  );

  const before = rockById(
    stood,
    rockId,
    "the rock the pause found on the field",
  );
  const after = rockById(resumed, rockId, "the rock the resumed field carries");
  assertLessThanOrEqual(
    Math.hypot(after.x - before.x, after.y - before.y),
    RESUME_SLACK,
    "the logical units the rock on the field moved across the resume, which " +
      "gives the field back exactly as it stood (specs/ui.md)",
  );
});
