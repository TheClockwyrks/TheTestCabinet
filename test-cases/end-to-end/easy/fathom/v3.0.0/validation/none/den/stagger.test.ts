// den/stagger — the den lets its hunters out one at a time, `DEN_RELEASE_GAP`
// apart, in the fixed order, and lets none out while the countdown runs.
//
// `specs/predators.md`: "Each predator has a release time, measured from the
// moment live play begins. The first predator's release time is `0 s` and each one
// after it is `DEN_RELEASE_GAP` (`5 s`) later"; "The order is `DEN_ORDER`: the
// Lanternjaw first, then the Gloamfin, then the Flarefish"; and "Release time `0`
// is the moment the dive countdown ends and `screen` becomes `"playing"`, so the
// countdown counts against nothing and no predator leaves the den while one is
// running."
//
// FOUR CLAIMS, AND A BUILD CAN HOLD ANY THREE OF THEM: the order, the head of the
// schedule, the spacing between slots, and the countdown counting against
// nothing. One watch reads all four.
//
// THE ORIGIN IS PINNED BY `beginPlay`, NOT GUESSED. `specs/ui.md` lets the
// countdown hold anywhere between `1 s` and `3 s`, so a schedule timed from
// `startDive` would be reading a length the specification deliberately left the
// build. `beginPlay` "ends the dive countdown immediately ... so `screen` becomes
// `"playing"` and the den's release schedule starts from that moment"
// (`specs/instrumentation.md`), and it runs no tick, so the `simTime` read
// straight after it is release time `0` exactly. The countdown claim is read
// BEFORE that, on the countdown the build was actually running.
//
// THIS ONE RUNS ON THE BUILD'S OWN MAZE, which is the exception to the posed
// fixtures everything else here uses: `setMaze` suspends the release schedule
// (`specs/instrumentation.md`), so a posed board is the one board with no
// schedule to read. What that costs is a forager standing in a real maze with real
// hunters coming out of a real den, which is what `parkClearOfDen` and the scene
// guard are for.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertLessThanOrEqual,
  assertNull,
} from "../assert";
import { DEN_ORDER, DEN_RELEASE_GAP } from "../constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import { sceneGuard, sceneHeld } from "../scene";
import {
  DEN_ORDER_LINE,
  RELEASE_TOLERANCE,
  dueAt,
  orderLine,
  parkClearOfDen,
  watchCountdown,
  watchReleases,
  watchSeconds,
} from "./schedule";

/** The seed the dive is opened on, so the maze this watch runs in replays. */
const SEED = 1;

/**
 * How much of the dive countdown is watched before it is ended, in seconds.
 *
 * `specs/ui.md` holds the countdown for "at least `1 s`", so nine tenths of a
 * second is a stretch every conforming build is still counting down through — and
 * it is nearly a fifth of a release slot, so a build running its den timers
 * through the countdown has visibly spent that much of the first one by the time
 * play begins. The watch stops early of its own accord if the screen turns over
 * sooner.
 */
const COUNTDOWN_WATCH = 0.9;

/** Ticks held after the last release, so the clip does not cut on it. */
const TAIL_TICKS = 60;

let h: Harness;

beforeEach(async (ctx) => {
  h = await createHarness(ctx);
});

afterEach(async () => {
  await h.dispose();
});

it("releases the den one predator at a time, DEN_RELEASE_GAP apart, in DEN_ORDER, and none during the countdown", async () => {
  await h.debug.reset({ seed: SEED });
  await h.debug.startDive();
  // The forager is a bystander to a clock, and the most expensive thing that can
  // happen to this measurement is its being caught: a life lost re-dens every
  // predator and starts the whole schedule again.
  await parkClearOfDen(h);

  const opening = await h.snapshot();
  if (opening.predators.length < DEN_ORDER.length) {
    h.unmet(
      `the depth-1 roster carries ${opening.predators.length} predators, and ` +
        `specs/predators.md gives it one of each of the three kinds, so there ` +
        `is no staggered schedule to read — what the roster holds is the ` +
        `progression checks' verdict, not this one's`,
    );
  }

  const watch = await captureReplay(h, "stagger", async () => {
    // The countdown, on the build's own clock, before anything ends it.
    const countdown = await watchCountdown(h, COUNTDOWN_WATCH);
    // Release time zero, pinned: no tick runs inside `beginPlay`, so the state
    // read straight after it is the moment the schedule starts from.
    await h.debug.beginPlay();
    const started = await h.snapshot();
    const guard = await sceneGuard(h, null);
    const den = await watchReleases(h, {
      seconds: watchSeconds(DEN_ORDER.length),
      count: DEN_ORDER.length,
    });
    // A beat past the last release, so the clip does not cut on the moment it
    // exists to show. Every reading is already taken.
    await h.advance(TAIL_TICKS);
    return { countdown, started, den, guard };
  });

  assertNull(
    sceneHeld(await h.snapshot(), watch.guard),
    "the scenario held to the end",
  );

  // The schedule is read off `released`, so a build that does not report it sees
  // no releases at all — which would otherwise read as a den that never opened.
  assertNull(
    watch.den.missingFlag,
    "specs/state.md requires `released` of every predator, and the schedule " +
      "specs/predators.md fixes is read off it",
  );

  // No hunter loose while the countdown ran.
  assertLength(
    watch.countdown.loose,
    0,
    `the predators released during the ${COUNTDOWN_WATCH} s of countdown ` +
      `watched (${orderLine(watch.countdown.loose)}), which ` +
      `specs/predators.md counts against nothing`,
  );

  // Order and completeness in one reading: comparing the sequence rather than
  // counting it shows exactly how far a den that stalls halfway got.
  assertEqual(
    orderLine(watch.den.releases.map((release) => release.kind)),
    DEN_ORDER_LINE,
    `the order the den emptied in, over the ` +
      `${watchSeconds(DEN_ORDER.length)} s after live play began`,
  );

  // And the schedule itself: the head at zero and every slot after it a whole
  // `DEN_RELEASE_GAP` later. Absolute rather than as gaps, because `beginPlay`
  // fixes the origin exactly, and gaps alone would pass a den that held every
  // hunter for half a minute and then let them out five seconds apart.
  for (const [slot, release] of watch.den.releases.entries()) {
    assertLessThanOrEqual(
      Math.abs(release.t - watch.started.simTime - dueAt(slot)),
      RELEASE_TOLERANCE,
      `how far the ${release.kind}'s release sat from the ${dueAt(slot)} s ` +
        `specs/predators.md gives slot ${slot} at ${DEN_RELEASE_GAP} s a slot, ` +
        `measured from the moment screen became playing`,
    );
  }
});
