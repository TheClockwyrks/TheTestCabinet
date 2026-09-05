// campaign/finale-ends-in-victory — the victory screen follows once the finale has run.
//
// specs/campaign.md's outcome table: "Victory — Wave `N` is cleared with Grid
// Integrity remaining — The finale runs, then the victory screen." The finale is
// not decoration: it "runs after wave `N` is cleared and before the victory
// screen", and it is what produces the run's only figure.
//
// TWO TRANSITIONS, TWO POINTS. A build that goes straight from the last clear to
// the victory screen has skipped the finale entirely; a build that enters the
// finale and then never leaves it has skipped the ending. Those are different
// failures, so `final-wave-enters-the-finale` decides the first transition and
// `finale-ends-in-victory` decides the second, matching how the rest of this
// checklist itemizes a transition at a time.
//
// `N` comes from the chosen difficulty (specs/difficulty.md) rather than being
// written here, so the check reads the run the build says it is running.
//
// HOW IT IS DECIDED. The run is taken to its finale by clearing wave `N` with the
// spawner held, which is the victory condition of specs/campaign.md and leaves the
// finale, and the Dynamo it releases, to the game — the first transition is the
// sibling point and it is what plays the composed wave `N`. The finale is then run
// to its end by walking its Overload Dynamo the last three tiles into the
// collector, which specs/campaign.md ends with "the game advances to the victory
// screen".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { difficultyById } from "../constants";
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

it("reaches the victory screen once the finale has run", async () => {
  const finale = await captureReplay(h, "victory", async () => {
    const { snapshot, waves } = await poseFinale(h, DIFFICULTY);
    assertEqual(
      waves,
      difficultyById(DIFFICULTY).waves,
      `the last wave of a ${DIFFICULTY} run`,
    );
    return snapshot;
  });

  const dynamo = onlyUnit(finale, "overload");
  const won = await leakOne(h, "overload", dynamo.id);
  assertEqual(
    won.screen,
    "victory",
    "the victory screen follows once the finale has run (specs/campaign.md)",
  );
});
