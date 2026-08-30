// progression/game-over-at-zero-lives — the contact that takes the last life
// ends the run.
//
// `specs/progression.md`, Losing a life: "A contact that takes lives to `0` ends
// the run instead: the game moves to the `gameover` screen, reporting `0` lives
// and the level the run reached." Winning and losing states the same outcome as
// the run's second ending.
//
// The board is posed with ONE life, which is the whole of what distinguishes
// this contact from the one `progression/life-lost-decrements` reads: the same
// segment in the same box, on the same posed board. A build that runs the
// ordinary respawn whatever the lives answers with the `playing` screen and a
// `respawn` phase; a build that ends the run a contact early answers `gameover`
// from two lives, which that point catches; a build that lets lives go negative
// answers `-1`; a correct build answers `gameover` and `0`.
//
// The lives are read beside the screen because the specification fixes both in
// the one sentence, and because a `gameover` screen reporting a life still in
// hand is the model a player would see as a run that ended early.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { contactCursor } from "./run";

/** The lives the board is posed with: the last one. */
const LAST_LIFE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("ends the run on the contact that takes the last life", async () => {
  await startPlaying(h);
  await h.debug.setLives(LAST_LIFE);

  await contactCursor(h);

  await captureStill(h, "gameover");
  const after = await h.snapshot();
  assertEqual(
    after.screen,
    "gameover",
    "the screen after the contact that took the last life",
  );
  assertEqual(after.lives, 0, "the lives the ended run reports");
});
