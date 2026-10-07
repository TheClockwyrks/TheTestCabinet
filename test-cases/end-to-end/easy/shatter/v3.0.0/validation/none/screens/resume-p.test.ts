// Shatter — screens/resume-p: `KeyP` resumes a paused game.
//
// THE RULE. `specs/controls.md`'s key table gives `KeyP` two meanings: "Pause"
// while the game is being played, and "Resume the paused game" on a menu.
// `specs/ui.md` says the same from the screen's side: "Leaving this screen and
// pausing again each do what `RESUME` does, so `Escape` and `P` alike resume the
// game from here", and `RESUME` "returns to `playing` with the field and the run
// exactly as they stood".
//
// WHY IT IS A SEPARATE ITEM FROM `controls/pause-p`. Opening the pause menu and
// closing it again are two branches of a build, on two different screens. A pause
// menu the key that opened it cannot dismiss is the classic half-wired pause, and
// a build that has it should lose exactly this point rather than the pause point
// as well.
//
// AND WHY IT IS A SEPARATE ITEM FROM `screens/resume-escape`. Two keys resume, and
// they are two listeners in a build. `KeyP` is the unambiguous one, carrying one
// meaning per screen where `Escape` carries two, so a build that wired only the
// plain key or only the ambiguous one loses exactly one point rather than both.
//
// THE FIELD IS POSED AND READ BACK. A build that RESTARTED on the key reaches
// `playing` too, so the screen alone decides nothing: the rock left standing and
// the score, ships and wave posed away from their opening figures are what
// separate a resume from a restart.
//
// THE KEY IS A REAL ONE, delivered by its `code` through Chromium's own input
// pipeline, because `specs/instrumentation.md` carries no keyboard operation at
// all under an engineless build.
//
// WHAT THIS ITEM DOES NOT DECIDE. That `KeyP` PAUSES (`controls/pause-p`), that
// the paused field is frozen (`screens/pause-freezes-the-field`), or what the
// menu's own `RESUME` entry does (`screens/resume-returns-to-play`).

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import { KEY_PAUSE } from "../constants";
import {
  captureStill,
  createHarness,
  poseRock,
  requireRock,
  startPlaying,
  type Harness,
} from "../harness";
import { SETTLE_TICKS, reachPaused } from "./screens";

/** A score no new game holds, so a restart could not be mistaken for a resume. */
const POSED_SCORE = 470;
/** Ships no new game holds: one already spent. */
const POSED_LIVES = 2;
/** A wave no new game holds. */
const POSED_WAVE = 4;

/** Where the standing rock is posed: at rest, far out, clear of the ship and the star. */
const ROCK_AT = { x: 200, y: 200 };

/**
 * How closely the standing rock must hold its place, as {@link assertCloseTo}
 * decimal places: one, so within `0.05` logical units.
 *
 * The rock is at rest `468` units from the star, where `specs/gravity.md` gives it
 * about `20` units per second squared; over the two ticks the press and its settle
 * cost, that is four thousandths of a unit. The bound is ten times that and still
 * thousands of times smaller than the nearest place a rebuilt field could have put
 * a rock, which `specs/progression.md` keeps at least `300` units from the ship.
 */
const STANDING_DIGITS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("gives back the paused game when KeyP is pressed", async () => {
  await startPlaying(h, { wave: POSED_WAVE });
  await h.debug.setScore(POSED_SCORE);
  await h.debug.setLives(POSED_LIVES);
  const rockId = await poseRock(h, "medium", ROCK_AT.x, ROCK_AT.y);

  await reachPaused(h);
  const paused = await h.snapshot();
  const rockBefore = requireRock(
    paused,
    rockId,
    "the rock standing at the pause",
  );

  await h.tap(KEY_PAUSE);
  await h.advance(SETTLE_TICKS);
  await captureStill(h, "resumed");

  const resumed = await h.snapshot();
  assertEqual(
    resumed.screen,
    "playing",
    "the screen KeyP gave a paused game (specs/ui.md)",
  );
  assertEqual(
    resumed.score,
    POSED_SCORE,
    "the score the resumed game came back to (specs/ui.md)",
  );
  assertEqual(
    resumed.lives,
    POSED_LIVES,
    "the ships the resumed game came back to (specs/ui.md)",
  );
  assertEqual(
    resumed.wave,
    POSED_WAVE,
    "the wave the resumed game came back to (specs/ui.md)",
  );

  const rockAfter = requireRock(
    resumed,
    rockId,
    "the rock still standing after the resume",
  );
  assertCloseTo(
    rockAfter.x,
    rockBefore.x,
    STANDING_DIGITS,
    "the standing rock's x after the resume (specs/ui.md)",
  );
  assertCloseTo(
    rockAfter.y,
    rockBefore.y,
    STANDING_DIGITS,
    "the standing rock's y after the resume (specs/ui.md)",
  );
});
