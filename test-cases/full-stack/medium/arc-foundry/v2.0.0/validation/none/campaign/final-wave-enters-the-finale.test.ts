// campaign/final-wave-enters-the-finale — clearing wave N opens the finale, not the victory screen.
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
// HOW IT IS DECIDED. The run's last wave is launched by the level's harvest and
// taken to its clear, and the phase is read on the frame it clears: `finale`, on
// the `playing` screen, with an Overload Dynamo released. What happens once the
// finale has run is the sibling point `finale-ends-in-victory`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { difficultyById } from "../constants";
import { captureReplay, type Harness } from "../harness";
import { createRunHarness, onlyUnit, reachFinale } from "./runs";

const DIFFICULTY = "easy";

let h: Harness;

beforeEach(async () => {
  h = await createRunHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts the run into the finale on the last clear", async () => {
  const finale = await captureReplay(h, "finale", async () => {
    const { cleared, waves } = await reachFinale(h, DIFFICULTY);
    assertEqual(
      waves,
      difficultyById(DIFFICULTY).waves,
      `the last wave of a ${DIFFICULTY} run`,
    );
    return cleared.snapshot;
  });

  assertEqual(
    finale.phase,
    "finale",
    "clearing wave N opens the finale rather than the victory screen " +
      "(specs/campaign.md)",
  );
  assertEqual(finale.screen, "playing", "the finale runs on the yard");
  assertGreaterThan(
    finale.integrity,
    0,
    "the run was won with Grid Integrity remaining",
  );
  onlyUnit(finale, "overload");
});
