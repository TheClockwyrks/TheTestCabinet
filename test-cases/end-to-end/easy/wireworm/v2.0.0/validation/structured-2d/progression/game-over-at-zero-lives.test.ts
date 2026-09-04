// progression/game-over-at-zero-lives — a contact with no lives to spare ends the
// run.
//
// specs/progression.md, Losing a life: a contact that takes lives to `0` ends the
// run INSTEAD of respawning — the game moves to the `gameover` screen, reporting
// `0` lives. So this is the same contact `life-lost-decrements` drives, posed at
// the one lives count where the rule takes its other branch, and the two points
// are what tell a build that decrements correctly but never ends the run apart
// from one that ends it a life early.
//
// The board holds nothing but the segment posed on the cursor, so the one
// contact that can happen is the one that decides this.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { poseContact } from "./contact";

/**
 * The lives the contact is posed at: the last one. specs/progression.md branches
 * on lives reaching `0`, so `1` is the only count from which one contact reaches
 * that branch — and the only count at which a build that respawns instead of
 * ending the run reads back a life it does not have.
 */
const LAST_LIFE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves to the gameover screen reporting no lives left", async () => {
  startPlaying(h);
  h.debug.setLives(LAST_LIFE);
  poseContact(h);

  await h.advance(1);
  const ended = h.snapshot();

  // One frame past the contact, so the picture kept is the game-over screen
  // rather than the last frame of play. The reading above decides the point.
  await h.advance(1);
  captureStill(h, "gameover");

  assertEqual(ended.screen, "gameover", "the screen the last life leaves");
  assertEqual(ended.lives, 0, "the lives the game-over screen reports");
});
