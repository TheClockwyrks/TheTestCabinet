// progression/game-over-records-level — the ended run reports the level it
// reached.
//
// specs/progression.md, Losing a life: a contact that takes lives to `0` moves
// the game to the `gameover` screen, reporting `0` lives AND the level the run
// reached. The level reached is the highest level the run has opened, and it is
// what the end screens report.
//
// THE RUN IS POSED PART-WAY THROUGH, DELIBERATELY. A run ended on level `1`
// cannot tell a build that reports the level reached from one that reports a
// constant, or one that resets the figure as the run ends. The run is posed on
// level `7` — over half way, and a number nothing else in this suite uses — so
// only a build that carried the figure into the end screen reads it back.
//
// Whether the run ended at all is `game-over-at-zero-lives`'s point; the screen
// is read here only because a figure "the end screens report" cannot be read
// anywhere else.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { poseContact } from "./contact";

/** The level the run is posed on, and the level its end must report. */
const LEVEL = 7;

/** The last life: the count from which one contact ends the run. */
const LAST_LIFE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports the level the run reached on the gameover screen", async () => {
  startPlaying(h);
  h.debug.setLevel(LEVEL);
  h.debug.setReachedLevel(LEVEL);
  h.debug.setLives(LAST_LIFE);
  poseContact(h);

  await h.advance(1);
  const ended = h.snapshot();

  // One frame past the contact, so the picture kept is the game-over screen.
  await h.advance(1);
  captureStill(h, "gameover");

  assertEqual(ended.screen, "gameover", "the screen the last life leaves");
  assertEqual(
    ended.reachedLevel,
    LEVEL,
    "the level the game-over screen reports",
  );
});
