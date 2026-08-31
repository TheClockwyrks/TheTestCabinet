// screens/resume-returns-to-play — RESUME gives the game back exactly as it stood.
//
// THE RULE. `specs/ui.md` gives the pause menu's first entry, `PAUSE_ITEMS[0]`
// (`RESUME`), one job: "returns to `playing` with the field and the run exactly as
// they stood". So confirming it moves the screen AND leaves everything else alone
// — which is the whole of what separates it from `RESTART`, the entry beside it.
//
// THE DISTINGUISHING POSE. A run posed at a new game's own figures would be
// resumed and restarted alike, so the run carries figures no new game has: a score
// of `POSED_SCORE`, `POSED_LIVES` ships rather than `START_LIVES`, wave
// `POSED_WAVE` rather than one, and a rock on the field. Every wrong model now
// reads differently — a build that restarted reads score `0` and three ships, a
// build that quit reads the title screen, a build that rebuilt the field reads no
// rock — and the failure names which.
//
// THE ENTRY IS ADDRESSED BY ITS INDEX. `specs/ui.md` fixes the ORDER of the pause
// entries but says nothing about which one a pause menu OPENS on, so the highlight
// is posed with `setMenuIndex` rather than assumed or driven there with a count of
// key presses. The entry's own copy is asserted first, so a build that reordered
// its menu fails naming the entry it put first rather than being graded against
// the wrong one; that ORDER is `screens/pause-menu-entries`' own point.
//
// THE FIELD IS READ WITH TWO TICKS OF SLACK, AND HERE IS WHY. The confirm is a
// real press, and `specs/controls.md` reads confirming as a press edge which the
// harness delivers across two frames — a build may answer on either, and both are
// conformant — so up to two ticks of live play can follow the resume before the
// reading is taken. `RESUME_SLACK` is what a posed body covers in that time with
// room to spare; the run's own figures carry no slack at all, because a score, a
// life count and a wave number do not drift.
//
// WHAT THIS ITEM DOES NOT DECIDE. That the paused field was frozen in the first
// place, which is `screens/pause-freezes-the-field`, nor that a key opens the
// pause menu, which is `controls/pause-p`.

import { afterEach, beforeEach, it } from "vitest";
import { PAUSE_ITEMS } from "../../src/constants";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  keyFor,
  poseRock,
  rockById,
  startPlaying,
  type Harness,
} from "../harness";

/** The entry `specs/ui.md` fixes as the pause menu's first: the one taken here. */
const RESUME = 0;

/** A run no new game has, so a build that restarted instead is caught. */
const POSED_SCORE = 4260;
const POSED_LIVES = 2;
const POSED_WAVE = 3;

/**
 * Where the rock on the paused field is posed, and how fast, in logical units.
 *
 * `394` units from the star at `(640, 360)`, outside everything it draws
 * (`specs/field.md`), clear of the ship and of every edge, drifting at a speed
 * inside the `130` to `210` a Small's own drift runs at (`specs/rocks.md`).
 */
const ROCK_SPOT = { x: 300, y: 160 };
const ROCK_DRIFT = 150;

/**
 * How far a body may have moved by the time the resumed field is read, in logical
 * units.
 *
 * The harness delivers a press across two frames and either may be the one the
 * build answers, so two ticks of live play may separate the resume from the
 * reading. Two ticks at `ROCK_DRIFT` is `2.5` units; four is that with room for
 * the well's own pull over the same two ticks, which at this distance is under a
 * hundredth of a unit. A build that rebuilt the field puts its rocks hundreds of
 * units away, or none at all.
 */
const RESUME_SLACK = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the run and the field the pause left, when RESUME is confirmed", async () => {
  assertEqual(
    PAUSE_ITEMS[RESUME],
    "RESUME",
    "the first entry of the pause menu specs/ui.md fixes",
  );

  startPlaying(h);
  h.debug.setScore(POSED_SCORE);
  h.debug.setLives(POSED_LIVES);
  h.debug.setWave(POSED_WAVE);
  const rockId = poseRock(h, "small", ROCK_SPOT.x, ROCK_SPOT.y, ROCK_DRIFT, 0);
  h.debug.setScreen("paused");
  h.debug.setMenuIndex(RESUME);

  const stood = h.snapshot();
  assertEqual(stood.screen, "paused", "the screen the entry was taken from");
  assertEqual(stood.menuIndex, RESUME, "the entry the highlight was posed on");

  await h.tap(keyFor("confirm"));
  captureStill(h, "resumed");

  const resumed = h.snapshot();
  assertEqual(
    resumed.screen,
    "playing",
    "the screen confirming RESUME returns to (specs/ui.md)",
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
      "returns the field exactly as it stood (specs/ui.md)",
  );
});
