// instrumentation/pellet-respawn-switch — `setPelletRespawn(false)` leaves an
// eaten pellet unreplaced.
//
// WHAT THE SWITCH IS FOR. specs/instrumentation.md: with `pelletRespawn` off
// "step 5 places none, so an eaten pellet leaves the board without one", and "no
// cell is looked for, so the board-cleared ending is not reached this way". The
// eat itself still resolves, which is the half that makes the switch usable: a
// point watching one eat is not then met by a pellet landing on a cell it did not
// choose, and nearly every growth, collision and combo scene in this project is
// posed that way.
//
// The eat is read through the score RISING rather than through a figure: what the
// award is worth is specs/scoring.md's, and the `scoring` points decide it. Here
// the score is only the witness that step 5 ran at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  arrangeEat,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the board without a pellet when one is eaten", async () => {
  const scene = arrangeEat(h, { pelletRespawn: false });
  assertEqual(
    scene.snapshot.pelletRespawn,
    false,
    "the switch the scene posed",
  );
  assertDeepEqual(
    scene.snapshot.pellet,
    scene.pellet,
    "the pellet to be eaten",
  );
  const before = scene.snapshot;

  const after = await captureReplay(h, "unreplaced", () => h.tick());

  // The pellet was eaten: the head is on its cell and the eat resolved.
  assertDeepEqual(after.snake[0], scene.pellet, "the head on the eaten cell");
  assertGreaterThan(after.score, before.score, "the score after the eat");

  // And nothing was placed in its stead, while the round carries on.
  assertEqual(after.pellet, null, "pellet with respawn off");
  assertEqual(after.screen, "playing", "the screen after the eat");
});
