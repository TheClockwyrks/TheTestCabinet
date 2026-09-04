// gameplay/advances-in-real-time — the game runs itself off the runtime's own loop.
//
// WHY THIS CHECK EXISTS. Every other check in this suite drives the simulation
// itself, through `engine.advance`, which is blind to this claim: a build whose
// game never advances unless something steps it would answer all of them
// perfectly while a person who opened it saw a frozen court. So this one alone
// never calls `advance` for the measured stretch. It hands the runtime a
// `WallClock` and starts `engine.run`, which pumps frames off the host's frame
// callback in real time, and then reads what the build did with them.
//
// TWO INDEPENDENT WITNESSES. The game's own accumulated `simTime`, which says the
// build integrated the elapsed seconds it was handed, and the distance the ball
// covered, which says the SIMULATION ran rather than a counter ticking up.
//
// WHAT IS READ, AND WHAT IS NOT. The claim is that the game advances ITSELF while
// real time passes, not that it keeps pace with a stopwatch, so nothing here
// compares the game's clock against elapsed real time. The loop is left running
// until the game's OWN clock has gained {@link MIN_ADVANCE}, under a real-time
// ceiling far longer than any running build needs; a machine busy enough to
// starve the frame callback spends more of that ceiling rather than producing a
// smaller reading, and a build that never advances itself gains exactly nothing
// and is still the only thing that fails.
//
// THE FIELD HOLDS THE BALL AND NOTHING ELSE. The travel below is a straight-line
// displacement, so anything that could turn the ball around would read as a
// build that advanced LESS than it did. Both obstacles are removed and both
// paddles are driven out of the lane, which leaves the served ball a clear
// quarter second of flight — the watch stops the moment the game's own clock has
// gained {@link MIN_ADVANCE}, by which point the ball has covered about 130
// units at the serve speed, against the 640 between the serve point and either
// goal edge.

import { afterEach, beforeEach, it } from "vitest";
import { WallClock } from "@test-cabinet/simple-2d";
import { SERVE_SPEED } from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  ball0,
  captureStill,
  createHarness,
  driveServe,
  openCountdown,
  parkPaddles,
  poseWorld,
  stageServe,
  TICK_HZ,
  type Harness,
} from "../harness";

/**
 * The floor the game's own clock must clear, in seconds: thirty frames at the
 * suite's step. Enough that neither a single stray frame nor rounding can reach
 * it, and small enough that a badly loaded machine still gets a running build
 * there well inside the watch's ceiling. A frozen build reports 0.
 */
const MIN_ADVANCE = 30 / TICK_HZ;
/**
 * The floor the ball must travel, in logical px. It leaves at the serve speed
 * across a field emptied of everything that could turn it, so over
 * {@link MIN_ADVANCE} of game time a straight-line flight covers
 * `SERVE_SPEED * MIN_ADVANCE`; the floor takes a fraction of that, since what it
 * witnesses is that the simulation moved at all rather than how far it got.
 */
const MIN_TRAVEL = (SERVE_SPEED * MIN_ADVANCE) / 2.5;

let harness: Harness;

beforeEach(async () => {
  // A real clock, because this is the one check about real elapsed time.
  harness = await createHarness({ clock: new WallClock() });
});

afterEach(() => {
  harness?.dispose();
});

it("advances on the runtime's frame loop with nothing stepping it", async () => {
  openCountdown(harness, "solo");
  poseWorld(harness, { live: false });
  parkPaddles(harness);

  // The hold is cut to nothing and the build's own serve rule launches the ball,
  // so the flight measured below is a real one on a field holding only it.
  stageServe(harness);
  const launched = await driveServe(harness);

  const before = harness.snapshot();
  captureStill(harness, "before");
  assertEqual(launched.hit, true);
  assertGreaterThan(ball0(before).speed, 1);

  const watched = await harness.runUntil(
    (s) => s.simTime - before.simTime > MIN_ADVANCE,
  );

  const after = watched.snapshot;
  // The pair is the evidence: two frames of the same match, with nothing between
  // them but the runtime's own loop. A build that never advanced itself produces
  // two identical pictures.
  captureStill(harness, "after");
  const advanced = after.simTime - before.simTime;
  const travelled = Math.hypot(
    ball0(after).x - ball0(before).x,
    ball0(after).y - ball0(before).y,
  );

  assertGreaterThan(advanced, MIN_ADVANCE);
  assertGreaterThan(travelled, MIN_TRAVEL);
});
