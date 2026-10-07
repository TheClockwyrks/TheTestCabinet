// Shatter — screens/resume-returns-to-play: confirming the pause menu's first entry
// gives back the game exactly as it stood.
//
// THE RULE. `specs/ui.md` puts `RESUME` first in `PAUSE_ITEMS` and says it "returns to
// `playing` with the field and the run exactly as they stood". Two halves of one
// requirement: the screen it lands on, and that nothing of the game was rebuilt on the
// way. A build that RESTARTED on this entry reaches `playing` too, so the screen alone
// decides nothing — it is the run and the body still standing that separate the two.
//
// THE RUN IS POSED AWAY FROM ITS OPENING FIGURES, on purpose. A game resumed and a game
// restarted both report `playing`; they differ in `score`, `lives` and `wave`, and only
// if those are not already what a fresh game holds. So the score is `470`, the ships
// `2` and the wave `4`, none of which `specs/progression.md` gives a new game, and each
// of which a restart would replace.
//
// AND A BODY IS LEFT STANDING. `specs/ui.md` says the FIELD comes back as it stood as
// well as the run, and a build that rebuilt the field would have spawned a fresh wave
// wherever its own placement rule put it. The rock is posed AT REST and far out, where
// the well moves it by a hundredth of a unit over the two ticks the confirm costs, so
// what the tolerance covers is gravity rather than the check's own imprecision.
//
// THE ENTRY IS ADDRESSED, NOT COUNTED, and the confirm key is a real one, because
// `specs/instrumentation.md` carries no operation that takes a menu entry. Which index
// `RESUME` is, is `screens/pause-menu-entries`' requirement.
//
// WHAT THIS ITEM DOES NOT DECIDE. That the pause FROZE the field
// (`screens/pause-freezes-the-field`), what the menu draws
// (`screens/pause-menu-entries`), or what the other two entries do.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  poseRock,
  requireRock,
  startPlaying,
  type Harness,
} from "../harness";
import { confirmEntry, reachPaused } from "./screens";

/** The pause menu's first entry, `RESUME` (`specs/ui.md`). */
const RESUME_ENTRY = 0;

/** A score no new game holds, so a restart could not be mistaken for a resume. */
const POSED_SCORE = 470;
/** Ships no new game holds: one already spent. */
const POSED_LIVES = 2;
/** A wave no new game holds. */
const POSED_WAVE = 4;

/** Where the standing rock is posed: at rest, far out, clear of the ship and the star. */
const ROCK_AT = { x: 200, y: 200 };

/**
 * How closely the standing rock must hold its place, as {@link assertCloseTo} decimal
 * places: one, so within `0.05` logical units.
 *
 * The rock is at rest `468` units from the star, where `specs/gravity.md` gives it
 * about `20` units per second squared; over the two ticks the confirm and its settle
 * cost, that is four thousandths of a unit. The bound is ten times that and still
 * thousands of times smaller than the nearest place a rebuilt field could have put a
 * rock, which `specs/progression.md` keeps at least `300` units from the ship.
 */
const STANDING_DIGITS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the game with its score, ships, wave and body exactly as they stood", async () => {
  assertEqual(
    PAUSE_ITEMS[RESUME_ENTRY],
    "RESUME",
    "the pause menu's first entry, which specs/ui.md fixes",
  );

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
  assertEqual(paused.score, POSED_SCORE, "the score the game was paused on");
  assertEqual(paused.lives, POSED_LIVES, "the ships the game was paused on");
  assertEqual(paused.wave, POSED_WAVE, "the wave the game was paused on");

  await confirmEntry(h, RESUME_ENTRY);
  await captureStill(h, "resumed");

  const resumed = await h.snapshot();
  assertEqual(
    resumed.screen,
    "playing",
    "the screen RESUME returned to (specs/ui.md)",
  );
  assertEqual(
    resumed.score,
    POSED_SCORE,
    "the score RESUME came back to (specs/ui.md)",
  );
  assertEqual(
    resumed.lives,
    POSED_LIVES,
    "the ships RESUME came back to (specs/ui.md)",
  );
  assertEqual(
    resumed.wave,
    POSED_WAVE,
    "the wave RESUME came back to (specs/ui.md)",
  );

  const rockAfter = requireRock(
    resumed,
    rockId,
    "the rock still standing after RESUME",
  );
  assertCloseTo(
    rockAfter.x,
    rockBefore.x,
    STANDING_DIGITS,
    "the standing rock's x after RESUME (specs/ui.md)",
  );
  assertCloseTo(
    rockAfter.y,
    rockBefore.y,
    STANDING_DIGITS,
    "the standing rock's y after RESUME (specs/ui.md)",
  );
});
