// Shatter — screens/resume-escape: `Escape` resumes a paused game, once.
//
// THE RULE. `specs/controls.md` gives `Escape` "Pause" while the game is being
// played and "Leave the screen" otherwise, and `specs/ui.md` says what leaving the
// pause menu is: "Leaving this screen and pausing again each do what `RESUME`
// does, so `Escape` and `P` alike resume the game from here." `RESUME` "returns to
// `playing` with the field and the run exactly as they stood".
//
// AND ONCE IS THE WHOLE OF THE REQUIREMENT. `specs/controls.md` reads leaving and
// pausing as press edges, "once per press", and states the precedence a paused
// frame is settled by: a frame carrying either resumes "and does nothing else". A
// build that resolves the one press twice — resuming and then pausing again on the
// same edge — reads `playing` for a tick and is back on the pause menu after it,
// which is why the screen is read again a quarter of a second later rather than
// only on the tick the press landed.
//
// THE FIELD IS POSED AND READ BACK. A build that RESTARTED on the key reaches
// `playing` too, so the screen alone decides nothing: the rock left standing and
// the score, ships and wave posed away from their opening figures are what
// separate a resume from a restart.
//
// WHAT THIS ITEM DOES NOT DECIDE. That `Escape` PAUSES (`controls/pause-escape`),
// that it leaves a menu screen (`controls/back-escape`), that `KeyP` resumes
// (`screens/resume-p`), or what the menu's `RESUME` entry does
// (`screens/resume-returns-to-play`).

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import { KEY_BACK } from "../constants";
import {
  captureStill,
  createHarness,
  poseRock,
  requireRock,
  startPlaying,
  ticksFor,
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

/** Ticks held after the resume, long enough that a re-pause would show. */
const SETTLED_TICKS = ticksFor(0.25);

/**
 * How closely the standing rock must hold its place, as {@link assertCloseTo}
 * decimal places: one, so within `0.05` logical units.
 *
 * The rock is at rest `468` units from the star, where `specs/gravity.md` gives it
 * about `20` units per second squared. Over the two ticks the press and its settle
 * cost that is four thousandths of a unit; the reading is taken there, before the
 * quarter second the re-pause check spends, so what the tolerance covers is
 * gravity rather than the check's own imprecision.
 */
const STANDING_DIGITS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("gives back the paused game when Escape is pressed, and leaves it given back", async () => {
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

  await h.tap(KEY_BACK);
  await h.advance(SETTLE_TICKS);
  await captureStill(h, "resumed");

  const resumed = await h.snapshot();
  assertEqual(
    resumed.screen,
    "playing",
    "the screen Escape gave a paused game (specs/ui.md)",
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

  await h.advance(SETTLED_TICKS);
  assertEqual(
    (await h.snapshot()).screen,
    "playing",
    "the screen a quarter of a second after the one Escape press — one press " +
      "resumes once and does nothing else (specs/controls.md)",
  );
});
