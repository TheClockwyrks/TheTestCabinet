// campaign/victory-after-final-wave — the finale runs between the last wave and victory.
//
// specs/campaign.md's outcome table: "Victory — Wave `N` is cleared with Grid
// Integrity remaining — The finale runs, then the victory screen." The finale is
// not decoration: it "runs after wave `N` is cleared and before the victory
// screen", and it is what produces the run's only figure. A build that goes
// straight from the last clear to the victory screen has skipped it, and the
// order of the two is what this check decides.
//
// The run's last wave is launched by the level's harvest and taken to its clear,
// and the phase is read on the frame it clears: `finale`, on the `playing`
// screen, with an Overload Dynamo released. The finale is then run to its end by
// walking that Dynamo the last three tiles into the collector — which
// specs/campaign.md ends with "the game advances to the victory screen" — and
// the screen is read again.
//
// `N` comes from the chosen difficulty (specs/difficulty.md) rather than being
// written here, so the check reads the run the build says it is running.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { captureReplay, difficultyById, type Harness } from "../harness";
import { createRunHarness, leakOne, onlyUnit, reachFinale } from "./runs";

const DIFFICULTY = "easy";

let h: Harness;

beforeEach(async () => {
  h = await createRunHarness();
});

afterEach(() => {
  h.dispose();
});

it("puts the run into the finale on the last clear, and onto victory after it", async () => {
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
    "clearing wave N opens the finale rather than the victory screen",
  );
  assertEqual(finale.screen, "playing", "the finale runs on the yard");
  assertGreaterThan(
    finale.integrity,
    0,
    "the run was won with Grid Integrity remaining",
  );

  const dynamo = onlyUnit(finale, "overload");
  const won = await leakOne(h, "overload", dynamo.id);
  assertEqual(
    won.screen,
    "victory",
    "the victory screen follows once the finale has run",
  );
});
