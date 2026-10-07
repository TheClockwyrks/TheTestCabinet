// campaign/finale-leak-is-free — the Overload Dynamo's own leak costs nothing.
//
// specs/campaign.md's finale, third step: "When it grounds out at the collector
// it costs no Grid Integrity, and the game advances to the victory screen."
// specs/enemies.md says the same of the unit: "Grounding out at the collector
// costs no Grid Integrity." Every other unit in the game costs its leak value
// there (specs/economy.md), so this is the one grounding that is free, and a
// build that runs the Dynamo through its ordinary leak path takes `5` — the
// Dynamo's leak value — off a run it had already won.
//
// The finale is a real one, ending a real run: wave `N` clears with Grid
// Integrity remaining, which is the victory condition of specs/campaign.md, and
// the game opens its own finale and releases its own Dynamo behind it. What is
// posed is the wave that clears — `poseFinale` clears the empty-schedule wave the
// spawner hold opens rather than playing the composed wave `N`, whose half minute
// of simulation this check reads nothing of. That the COMPOSED wave `N` opens the
// finale is the sibling point `final-wave-enters-the-finale`, which is the one
// check in this family that plays it.
//
// The Dynamo is then walked the last three tiles into the collector rather than
// being followed the whole way round, because the length of its walk is the
// sibling `finale-dynamo-walks` check and what this one is about is the frame it
// arrives on.
//
// Grid Integrity is read either side of that frame, and the screen on it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { captureReplay, type Harness } from "../harness";
import { createRunHarness, leakOne, onlyUnit, poseFinale } from "./runs";

const DIFFICULTY = "easy";

let h: Harness;

beforeEach(async () => {
  h = await createRunHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes no Grid Integrity when the Dynamo grounds out, and wins the run", async () => {
  const { snapshot: finale } = await poseFinale(h, DIFFICULTY);
  assertEqual(finale.phase, "finale", "the finale is running");

  const before = finale.integrity;
  assertGreaterThan(before, 0, "the run reached its finale with a grid intact");

  const dynamo = onlyUnit(finale, "overload");
  const grounded = await captureReplay(h, "ground", () =>
    leakOne(h, "overload", dynamo.id),
  );

  assertEqual(
    grounded.integrity,
    before,
    "the Overload Dynamo grounding out costs no Grid Integrity",
  );
  assertEqual(
    grounded.screen,
    "victory",
    "the frame it grounds out, the run reaches the victory screen",
  );
});
