// screens/resume-escape — the leave key gives a paused game back, once.
//
// THE RULE. `specs/controls.md` gives `back` the meaning "Leave the screen" on a
// menu screen, and `specs/ui.md` says what leaving the pause menu is: "Leaving
// this screen and pausing again each do what `RESUME` does". `RESUME` "returns to
// `playing` with the field and the run exactly as they stood".
//
// AND ONCE IS HALF THE REQUIREMENT. `Escape` is bound to `back` AND to `pause`, so
// one press raises both actions on one frame. `specs/controls.md` settles what
// that frame does: "On `paused`, `pause` and `back` are read before the menu
// edges, and a frame carrying either resumes and does nothing else", so "a single
// `Escape` press on `paused` resumes once". A build that answered both actions in
// turn would resume and immediately pause again, reading `playing` for a tick and
// the pause menu after it — which is why the screen is read again a quarter of a
// second later rather than only on the tick the press landed.
//
// THE DISTINGUISHING POSE. A build that RESTARTED on the key reaches `playing`
// too, so the run carries figures no new game has and a rock stands on the field.
//
// WHAT THIS ITEM DOES NOT DECIDE. That `Escape` pauses (`controls/pause-escape`),
// that it leaves a menu screen (`controls/back-escape`), that the pause key
// resumes (`screens/resume-p`), or what the `RESUME` entry does
// (`screens/resume-returns-to-play`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { BINDINGS } from "../constants";
import {
  captureStill,
  createHarness,
  poseRock,
  rockById,
  startPlaying,
  ticksFor,
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

/** Ticks held after the resume, long enough that a re-pause would show. */
const SETTLED_TICKS = ticksFor(0.25);

/**
 * The key pressed here: the one `specs/controls.md` binds to `back`, which it also
 * binds to `pause`. Read to drive the build and never compared against — which key
 * raises `back` is `controls/back-escape`'s point.
 */
const BACK_KEY = BINDINGS.back.keys[0] ?? "Escape";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives the paused game back on one Escape press, and leaves it given back", async () => {
  startPlaying(h);
  h.debug.setScore(POSED_SCORE);
  h.debug.setLives(POSED_LIVES);
  h.debug.setWave(POSED_WAVE);
  const rockId = poseRock(h, "small", ROCK_SPOT.x, ROCK_SPOT.y, ROCK_DRIFT, 0);
  h.debug.setScreen("paused");

  const stood = h.snapshot();
  assertEqual(stood.screen, "paused", "the screen the press was made on");

  await h.tap(BACK_KEY);
  captureStill(h, "resumed");

  const resumed = h.snapshot();
  assertEqual(
    resumed.screen,
    "playing",
    "the screen one Escape press gives a paused game (specs/ui.md)",
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

  await h.advance(SETTLED_TICKS);
  assertEqual(
    h.snapshot().screen,
    "playing",
    "the screen a quarter of a second after the one Escape press — a frame " +
      "carrying pause or back resumes and does nothing else " +
      "(specs/controls.md)",
  );
});
