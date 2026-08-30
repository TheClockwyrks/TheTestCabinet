// progression/game-over-records-level — the ended run reports the level it
// reached.
//
// THE RULE. `specs/progression.md`, *Losing a life*: the run *moves to the
// `gameover` screen, reporting `0` lives and the level the run reached*, and, from
// *Clearing a level*: *the level reached is the highest level the run has opened,
// and it is what the end screens report*.
//
// WHY BOTH FIGURES ARE POSED TOGETHER. The level reached is the highest level the
// run has opened, so during a run it is the level being played; a world posing the
// two apart would be a world the game's own rules could not produce. The run is
// therefore posed on level 7 with 7 reached, and what is read is that ending the
// run leaves the reached figure standing. A build that clears it on the way to the
// end screen, that reports the fresh-run `1`, or that reports one either side of
// the level reads a different number.
//
// The level is posed well away from `1`, so a build that resets the run's figures
// as it ends could not land on the answer by accident.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { poseContact } from "./scenario";

/** The level the run is on when it ends, which is the level it has reached. */
const LEVEL = 7;

/** The last life, so the contact ends the run. */
const LAST_LIFE = 1;

/** How long the contact is given to resolve, in frames. */
const CONTACT_FRAMES = ticksFor(0.05);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("reports the level the run reached on the gameover screen", async () => {
  const { debug } = harness;
  startPlaying(harness);
  debug.setLevel(LEVEL);
  debug.setReachedLevel(LEVEL);
  debug.setLives(LAST_LIFE);
  poseContact(harness);

  await harness.advance(CONTACT_FRAMES);

  captureStill(harness, "gameover");
  assertEqual(harness.snapshot().reachedLevel, LEVEL);
});
