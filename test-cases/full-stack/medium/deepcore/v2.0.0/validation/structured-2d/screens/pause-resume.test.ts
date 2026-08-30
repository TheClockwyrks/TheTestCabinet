// screens/pause-resume — RESUME picks the fall up exactly where it stopped.
//
// specs/ui.md: on `paused`, `RESUME` is the first of `PAUSE_ITEMS`, and the pause
// menu sits "over the frozen, dimmed world". So resuming returns to `in-mine` and
// the simulation carries on from the state the pause left: the same position, the
// same downward speed, and gravity taking it from there.
//
// THE READING IS THE CONTINUATION, not the return. That the screen changes back
// is one line; what this decides is that the fall is the SAME fall — the speed at
// the instant of the resume is the speed at the instant of the pause, and the
// miner then keeps going down and keeps getting faster, which specs/character.md
// says it must while there is open space below it.
//
// ISOLATION. An empty mine with the miner dropped down it and no floor within
// reach, the drill gated so no held key can cut, and nothing else in the world.

import { afterEach, beforeEach, it } from "vitest";
import { GRAVITY, PAUSE_ITEMS } from "../../src/constants";
import { assertBetween, assertEqual, assertGreaterThan } from "../assert";
import {
  ACTION_KEY,
  TICK_HZ,
  captureReplay,
  createHarness,
  minerXOn,
  minerYOn,
  openScene,
  pinDrill,
  type Harness,
} from "../harness";

/** Where the fall starts, in an empty mine with hundreds of open rows below it. */
const COL = 16;
const START_ROW = 20;

/** The downward speed the fall opens at, so the miner is plainly in motion. */
const START_VY = 400;

/** Frames the fall runs for before the menu is opened, and after it is closed. */
const FALL_FRAMES = 30;

/**
 * How much of the resumed fall may already have happened when it is read.
 *
 * Choosing `RESUME` is a key press, and a press is only a press because a frame
 * runs while it is held — so the game is legitimately back in the mine for that
 * frame, and one frame of gravity is legitimately already in the speed. Two
 * frames' worth is that with room to spare, and it is nowhere near the whole of
 * the speed the pause held: a build that restarted the fall from rest reads far
 * below the lower bound rather than just inside the upper one.
 */
const RESUME_FRAMES = 2;
const SPEED_SLACK = (GRAVITY * RESUME_FRAMES) / TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the mine and carries the fall on from where it stopped", async () => {
  openScene(h);
  pinDrill(h);
  h.debug.setMinerPosition(minerXOn(COL), minerYOn(START_ROW));
  h.debug.setMinerVelocity(0, START_VY);
  await h.advance(FALL_FRAMES);

  await h.tap(ACTION_KEY.pause);
  const paused = h.snapshot();
  assertEqual(
    paused.screen,
    "paused",
    "specs/controls.md: pause opens the pause menu during play",
  );

  const resumed = await captureReplay(h, "resume", async () => {
    h.debug.setMenuIndex(PAUSE_ITEMS.indexOf("RESUME"));
    await h.tap(ACTION_KEY.activate);
    const opened = h.snapshot();
    await h.advance(FALL_FRAMES);
    return { opened, after: h.snapshot() };
  });

  assertEqual(
    resumed.opened.screen,
    "in-mine",
    "specs/ui.md: RESUME closes the pause menu back to in-mine",
  );
  assertBetween(
    resumed.opened.miner.vy,
    paused.miner.vy - 0.5,
    paused.miner.vy + SPEED_SLACK,
    "specs/ui.md: the simulation continues from the speed it stopped at",
  );
  assertBetween(
    resumed.opened.miner.y,
    paused.miner.y - 0.5,
    paused.miner.y +
      ((paused.miner.vy + SPEED_SLACK) * RESUME_FRAMES) / TICK_HZ,
    "specs/ui.md: the miner resumes from the position it was paused at",
  );
  assertGreaterThan(
    resumed.after.miner.y,
    resumed.opened.miner.y,
    "specs/character.md: the fall carries on once the menu is closed",
  );
  assertGreaterThan(
    resumed.after.miner.vy,
    resumed.opened.miner.vy,
    "specs/character.md: gravity keeps accelerating the fall after the resume",
  );
});
