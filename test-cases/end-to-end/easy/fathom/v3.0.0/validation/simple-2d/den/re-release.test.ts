// den/re-release — losing a life puts every hunter back in the den, unreleased,
// and runs the whole staggered schedule again from the moment play resumes.
//
// `specs/predators.md`: "Losing a life returns every predator to the den
// unreleased, and the whole schedule runs again from the moment play resumes."
// `specs/progression.md` says the same of the attempt a catch sets up: "Every
// predator is back in the den with its `released` flag `false`, and the staggered
// release schedule in `specs/predators.md` runs again from the moment live play
// resumes."
//
// WHY THIS CANNOT BE FOLDED INTO `den/stagger`. The build this exists to catch is
// the one that holds each release time as an ABSOLUTE moment against a clock the
// respawn never resets. On the first maze that build is perfect — `0`, `5`, `10`
// against a `simTime` that started at `0` — and it only comes apart after a life
// is lost, when every slot is already in the past and the whole den spills out at
// once. `den/stagger` is the case that build gets right.
//
// THE CATCH IS A TRIGGER, NOT A SUBJECT, AND IT IS DRIVEN AT ONCE. A Lanternjaw is
// posed onto the forager's own tile in `chase` and the build's own contact rule
// takes the life; nothing here writes a life count. The pose is instant on purpose:
// every moment spent staging a prettier catch is a moment the OTHER hunters' den
// timers keep running before the clock this item reads has even started.
//
// AND THE RESUMED ORIGIN IS PINNED THE SAME WAY `den/stagger` pins the first one.
// The catch drops the dive back into a countdown of a length `specs/ui.md` leaves
// between `1 s` and `3 s`, so `beginPlay` ends it and the `simTime` straight after
// is release time `0` of the re-run schedule, exactly.
//
// THIS ONE RUNS ON THE BUILD'S OWN MAZE, for the reason `den/stagger` gives:
// `setMaze` suspends the release schedule, so a posed board has no schedule to
// read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual, assertTrue } from "../assert";
import { DEN_ORDER, DEN_RELEASE_GAP } from "../../src/constants";
import { captureReplay, createHarness, ticks, type Harness } from "../harness";
import {
  graded,
  predIndex,
  requireSceneHeld,
  sceneGuard,
  unmetPrecondition,
} from "../scene";
import {
  DEN_ORDER_LINE,
  RELEASE_TOLERANCE,
  dueAt,
  orderLine,
  parkClearOfDen,
  watchReleases,
  watchSeconds,
} from "./schedule";

/** The seed the dive is opened on, so the maze this watch runs in replays. */
const SEED = 1;

/**
 * How long a hunter posed onto the forager's own tile is given to take the life,
 * in ticks.
 *
 * `specs/gameplay.md` makes contact a tile test — "the forager is in contact with
 * a predator whose center lies on the forager's own tile" — which is already true
 * on the tick the pose lands, so a conforming build takes the life on the next
 * one. Two seconds is a ceiling rather than an expectation, and a build that
 * misses it is reported against `scoring/caught-costs-life` rather than here.
 */
const CATCH_TICKS = ticks(2);

/**
 * Ticks run after the life is lost before the den is read, so the reading is a
 * beat past the event rather than on the tick it landed.
 *
 * `specs/progression.md` fixes what the attempt is set up with and leaves the
 * order inside a tick to the build, so a build that drops the life and re-dens on
 * the following step honours the page exactly as one that does both at once.
 */
const SETTLE_TICKS = 4;

/** Ticks held after the last release, so the clip does not cut on it. */
const TAIL_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns every predator to the den on a catch and runs the whole staggered schedule again from the moment play resumes", async (ctx) => {
  await graded(ctx, async () => {
    h.debug.reset({ seed: SEED });
    h.debug.startDive();
    h.debug.beginPlay();
    await parkClearOfDen(h);

    const opening = h.snapshot();
    if (opening.predators.length < DEN_ORDER.length) {
      unmetPrecondition(
        `the depth-1 roster carries ${opening.predators.length} predators, and ` +
          `specs/predators.md gives it one of each of the three kinds, so there ` +
          `is no staggered schedule to run again — what the roster holds is the ` +
          `progression checks' verdict, not this one's`,
      );
    }
    const found = predIndex(opening, "lanternjaw");
    if (found < 0) {
      unmetPrecondition(
        "the roster carries no Lanternjaw to take the life with, so there is no " +
          "catch to re-release from — what the roster holds is the progression " +
          "checks' verdict, not this one's",
      );
    }
    const hunter = found;

    const run = await captureReplay(h, "rerelease", async () => {
      const before = h.snapshot();
      // Onto the forager's own tile, fixed on it: the build's own chase-and-contact
      // code takes the life on its own terms.
      h.debug.setPredatorTile(hunter, before.forager.tx, before.forager.ty);
      h.debug.setPredatorState(hunter, "chase");
      const caught = await h.until((snap) => snap.lives < before.lives, {
        maxFrames: CATCH_TICKS,
        poll: 1,
      });
      await h.advance(SETTLE_TICKS);
      const denned = h.snapshot();

      // The respawn puts the forager back on its start tile, which is near the den
      // it is about to watch empty; park it clear again before the clock starts.
      await parkClearOfDen(h);
      // The resumed origin, pinned exactly as the first one is.
      if (h.snapshot().screen === "countdown") h.debug.beginPlay();
      const resumed = h.snapshot();
      const guard = await sceneGuard(h);
      const den = await watchReleases(h, {
        seconds: watchSeconds(DEN_ORDER.length),
        count: DEN_ORDER.length,
      });
      await h.advance(TAIL_TICKS);
      return { before, caught, denned, resumed, den, guard };
    });

    // Without a life lost there is no re-release to read, and whether contact costs
    // one is `scoring/caught-costs-life`'s verdict.
    if (!run.caught.hit) {
      unmetPrecondition(
        `a Lanternjaw posed onto the forager's own tile did not cost a life ` +
          `within ${CATCH_TICKS} ticks, so there was no re-release to time — ` +
          `whether contact costs a life is scoring/caught-costs-life's verdict, ` +
          `not this one's`,
      );
    }

    requireSceneHeld(h.snapshot(), run.guard);
    if (run.den.missingFlag !== null) {
      unmetPrecondition(
        `${run.den.missingFlag}, ` +
          "so there is no schedule here to read: specs/state.md requires " +
          "`released` of every predator and the schedule specs/predators.md " +
          "fixes is read off it. What a snapshot must carry is " +
          "instrumentation/snapshot-shape's verdict, not this one's",
      );
    }

    // Half one: the catch put every hunter back, unreleased.
    for (const predator of run.denned.predators) {
      assertEqual(
        predator.released,
        false,
        `the ${predator.kind}'s \`released\` flag ${SETTLE_TICKS} ticks after ` +
          `the life was lost`,
      );
      assertEqual(
        predator.state,
        "den",
        `the ${predator.kind}'s state ${SETTLE_TICKS} ticks after the life was lost`,
      );
    }
    assertTrue(
      run.resumed.screen === "playing",
      "the dive resumed live play after the catch, so the re-run schedule has a " +
        "moment to run from",
    );

    // Half two: the whole schedule again, in order and on its slots.
    assertEqual(
      orderLine(run.den.releases.map((release) => release.kind)),
      DEN_ORDER_LINE,
      `the order the den emptied in over the ` +
        `${watchSeconds(DEN_ORDER.length)} s after play resumed`,
    );
    for (const [slot, release] of run.den.releases.entries()) {
      assertLessThanOrEqual(
        Math.abs(release.t - run.resumed.simTime - dueAt(slot)),
        RELEASE_TOLERANCE,
        `how far the ${release.kind}'s release sat from the ${dueAt(slot)} s ` +
          `specs/predators.md gives slot ${slot} at ${DEN_RELEASE_GAP} s a slot, ` +
          `measured from the moment play resumed`,
      );
    }
  });
});
