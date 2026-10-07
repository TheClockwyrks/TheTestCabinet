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
//
// THIS IS THE ONE CHECK IN THE FAMILY THAT PLAYS THE COMPOSED WAVE `N`. Its
// requirement IS the transition out of that wave, so the wave the game itself
// composed is the wave that has to clear here: the harvest launches it, its own
// schedule runs to exhaustion, and the phase behind it is what is read. The
// sibling finale points pose that clear instead, with the empty-schedule wave
// `spawnUnit` opens (`campaign/runs.ts`'s `poseFinale`), so the half minute of
// simulation wave `N` costs is spent once, here, where it is the requirement.
//
// WHAT IT COSTS IS THE SPAN, NOT THE FRAMES. Wave `N` is half a minute of
// simulation whatever frame size it is divided into, and this check reads no
// position and no projectile across it — only the wave counter, the phase and the
// screen. specs/instrumentation.md guarantees that "an interval of simulation time
// reaches the same state however it was divided into frames", which
// `instrumentation/frame-division-movement` and
// `instrumentation/frame-division-projectile` decide, so the wave is played out at
// `WAVE_HZ` and the span is untouched.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { captureReplay, type Harness } from "../harness";
import { createRunHarness, onlyUnit, reachFinale } from "./runs";
import { difficultyById } from "../constants";

const DIFFICULTY = "easy";

/** The frame rate wave `N` is played out at: see the header. */
const WAVE_HZ = 5;

let h: Harness;

beforeEach(async () => {
  h = await createRunHarness(WAVE_HZ);
});

afterEach(() => {
  h.dispose();
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
