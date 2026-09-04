// flarefish/flare-cadence — a wandering Flarefish charges for `FLARE_CHARGE`,
// blooms for `FLARE_BLOOM`, and starts charging again a whole `FLARE_INTERVAL`
// after the bloom ended.
//
// `specs/predators/flarefish.md` lays the cycle out in two numbered beats —
// "Charge-up, for `FLARE_CHARGE` (`0.5 s`) ... `flareCharging` is true for this
// window" and "Bloom, for `FLARE_BLOOM` (`1 s`), starting the moment the charge-up
// ends ... `flaring` is true ... for this window" — and then fixes the reload:
// "The timer restarts at `FLARE_INTERVAL` (`7 s`) as the bloom ends, so
// consecutive charge-ups begin `8.5 s` apart while the Flarefish keeps wandering."
//
// THE INTERVAL IS MEASURED BETWEEN TWO CHARGE-UPS, NOT FROM THE DIVE. Nothing in
// the specification fixes where in its cycle a Flarefish stands when it is posed
// out of the den, so an absolute reading would be grading a build on the one
// number the page leaves free. What the page does fix is the gap between
// consecutive charge-ups, and that is what this times.
//
// THE FIRST CYCLE IS WATCHED OFF CAMERA AND THE SECOND ON IT. A whole cycle is
// eight and a half seconds, most of it a dark hallway, so the recording opens on
// the second charge-up — the moment the item is named for — and runs through its
// bloom. The first cycle is still a real cycle of the build's own simulation; it
// simply costs the clip nothing.
//
// THE THREE BEATS ARE READ SEPARATELY because a build can hold any two of them: a
// charge that runs straight into a bloom with no window of its own, a bloom that
// outstays its second, and a timer that reloads short all pass the other two.
//
// WHAT THIS DOES NOT DECIDE. How wide the bloom is or what it lights, which are
// `flarefish/flare-reveals`'s; and whether anything of the Flarefish is drawn
// between flares, which is `flarefish/no-tell`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { FLARE_BLOOM, FLARE_CHARGE, FLARE_INTERVAL } from "../constants";
import {
  captureReplay,
  createHarness,
  ticks,
  type FathomSnapshot,
  type Harness,
  startPlaying,
} from "../harness";
import { requireSceneHeld, sceneGuard } from "../scene";
import {
  BLOOM_MAX,
  CHARGE_MAX,
  FIRST_FLARE_MAX,
  FLARE_POLL,
  FLARE_WAIT_POLL,
  NEXT_FLARE_MAX,
  poseFlareRoom,
} from "./room";

/**
 * How far a measured beat may sit from the figure the specification gives it, in
 * seconds.
 *
 * The item's own bounds: a tenth of a second for the charge and the bloom, a
 * fifth for the gap between consecutive charge-ups, which is the sum of three
 * figures and so carries three beats' worth of a build's own rounding.
 *
 * WHAT EACH BAND ACTUALLY LEAVES THE BUILD, WHICH IS NOT THE SAME FOR THE THREE.
 * An edge is seen at the first sample at or after it, so a sweep of `poll` ticks
 * reports it up to `poll - 1` ticks late, and a span measured between two edges is
 * out by the difference between how late each of the two was seen. The three spans
 * here are not read off the same grid — the two charge-ups are the most expensive
 * edges in the check and are swept at {@link CYCLE_POLL} (`8`), everything inside
 * a cycle at `FLARE_POLL` (`4`) — so each states its own budget:
 *
 *   * the BLOOM opens and closes on `FLARE_POLL` edges, so it reads within three
 *     ticks (`0.025 s`) either way and leaves the build the other nine ticks
 *     (`0.075 s`) of its tenth;
 *   * the CHARGE-UP opens on a `CYCLE_POLL` edge and closes on a `FLARE_POLL`
 *     one, so it reads up to seven ticks (`0.058 s`) SHORT and three ticks
 *     (`0.025 s`) long — the tightest of the three, and still five ticks
 *     (`0.042 s`) of its tenth left to the build on the tighter side;
 *   * the CYCLE opens and closes on `CYCLE_POLL` edges, so it reads within seven
 *     ticks (`0.058 s`) either way of a band twice as wide, leaving seventeen
 *     ticks (`0.142 s`).
 *
 * The smallest of those margins is five of the build's own frames, which is the
 * rounding these bands exist to absorb; none of them is a reading of the host.
 */
const BEAT_TOLERANCE = 0.1;
const CYCLE_TOLERANCE = 0.2;

/**
 * How often the two charge-ups the CYCLE is measured between are looked for, in
 * ticks: a fifteenth of a second.
 *
 * The cycle's band is twice a beat's, so the edges it is measured between can be
 * resolved half as finely and still leave over two thirds of the band to the
 * build. They are the two most expensive edges in this check — each is a whole
 * `FLARE_INTERVAL` (`7 s`) of wandering away, and `specs/instrumentation.md` has
 * every sample redraw — so halving their cost is most of what this check costs.
 * The beats inside a cycle stay at {@link FLARE_POLL}.
 *
 * WHAT ELSE HANGS OFF THE SECOND CHARGE-UP'S EDGE. It is not only a cycle edge:
 * it also opens the charge-up beat and anchors the held-charge reading, and both
 * of those inherit ITS resolution rather than `FLARE_POLL`'s. {@link BEAT_TOLERANCE}
 * states what that leaves the beat and {@link heldMargin} is what keeps the
 * reading inside the window; a margin sized for `FLARE_POLL` reads past the end of
 * a `60`-tick charge-up on the alignments where this sweep is more than five ticks
 * late, which fails a conforming build for where its onset happened to land.
 */
const CYCLE_POLL = 8;

/**
 * The gap between consecutive charge-ups, in seconds.
 *
 * `FLARE_CHARGE + FLARE_BLOOM + FLARE_INTERVAL`, which
 * `specs/predators/flarefish.md` states as `8.5 s`: the timer reloads as the bloom
 * ends, so a whole interval plus the cycle it follows separates one charge-up from
 * the next.
 */
const CHARGE_TO_CHARGE = FLARE_CHARGE + FLARE_BLOOM + FLARE_INTERVAL;

/**
 * How long before the far end of a window the flag that fills it is read, in
 * ticks, for a window whose onset was found by a sweep of `poll`.
 *
 * The gap between two onsets says when a beat ended and nothing about whether the
 * flag stayed up across it: a build whose `flareCharging` falls after a frame and
 * whose bloom still opens on time satisfies every onset this check times and gives
 * the player none of the telegraph `specs/predators/flarefish.md` describes. So
 * each flag is also read near the far end of the window it is stated to fill —
 * short of that end by the resolution of THE SWEEP THAT FOUND ITS ONSET and a
 * tick, so the reading is inside the window under any reading of which tick the
 * flag rose on.
 *
 * THE MARGIN FOLLOWS THAT SWEEP, WHICH IS NOT THE SAME ONE FOR BOTH FLAGS. A sweep
 * of `poll` ticks sees an onset up to `poll - 1` ticks after it, so backing off by
 * `poll` already lands the reading on the window's last tick in the worst case and
 * the extra tick is slack. The charge-up's onset is found by the CYCLE sweep, at
 * {@link CYCLE_POLL}; the bloom's by the beat sweep, at {@link FLARE_POLL}. One
 * constant for both is therefore right for one flag and wrong for the other: six
 * ticks of margin against a charge-up onset seen up to seven ticks late reads two
 * ticks PAST the `60`-tick charge window and fails a build that held the flag for
 * every one of them — a verdict on where the onset fell against the sample grid,
 * not on the build.
 */
const heldMargin = (poll: number): number => poll + 2;

/** The margin for the charge-up flag, whose onset the CYCLE sweep found. */
const CHARGE_HELD_MARGIN = heldMargin(CYCLE_POLL);

/** The margin for the bloom flag, whose onset the beat sweep found. */
const BLOOM_HELD_MARGIN = heldMargin(FLARE_POLL);

/** Ticks held after the second bloom ends, so the clip shows it finish. */
const TAIL_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("charges for FLARE_CHARGE, blooms for FLARE_BLOOM, and charges again a whole FLARE_INTERVAL after the bloom ends", async () => {
  await startPlaying(h);
  const room = await poseFlareRoom(h);
  const guard = await sceneGuard(h);

  const fish = (snap: FathomSnapshot): FathomSnapshot["predators"][number] =>
    snap.predators[room.index];
  const charging = (snap: FathomSnapshot): boolean =>
    fish(snap).flareCharging === true;
  const blooming = (snap: FathomSnapshot): boolean =>
    fish(snap).flaring === true;

  /**
   * Stand the check down if the Flarefish stopped wandering.
   *
   * The timer "runs down only while the Flarefish is wandering with no flare in
   * progress" (`specs/predators/flarefish.md`), so a Flarefish that has found the
   * forager has no cadence to time. The two rooms are eleven tiles apart and
   * sealed from each other, well past both of its reaches, so this can only fire
   * on a build whose sense reaches further than `specs/predators/flarefish.md`
   * gives it — which is `flarefish/light-sense`'s verdict.
   */
  const stillWandering = (snap: FathomSnapshot, what: string): void => {
    assertEqual(
      fish(snap).state,
      "wander",
      `the Flarefish's state before ${what}, from a sealed hallway eleven ` +
        "tiles from a forager at G = 0 — a Flarefish that has found the " +
        "forager neither charges nor blooms (specs/predators/flarefish.md), " +
        "so a cadence can only be timed on one that is still wandering",
    );
  };

  // A sweep reports a hit on its first read, so the opening state is captured
  // before any of them runs rather than from one.
  const opening = await h.snapshot();
  assertEqual(
    fish(opening).flareCharging,
    false,
    "the Flarefish is not already charging when the watch opens",
  );
  assertEqual(
    fish(opening).flaring,
    false,
    "the Flarefish is not already blooming when the watch opens",
  );

  // Off camera: a whole first cycle, so the second charge-up is timed from a
  // charge-up rather than from the pose.
  const firstCharge = await h.until(charging, {
    maxTicks: ticks(FIRST_FLARE_MAX),
    poll: CYCLE_POLL,
  });
  stillWandering(firstCharge.snapshot, "it first charged up");
  assertEqual(
    firstCharge.hit,
    true,
    `a wandering Flarefish charged up within ${FIRST_FLARE_MAX} s`,
  );
  // Pure waits, both: only `hit` and the hunter's state are read off them, and
  // the cycle below is measured between the two CHARGE-UPS.
  const firstBloom = await h.until(blooming, {
    maxTicks: ticks(CHARGE_MAX),
    poll: FLARE_WAIT_POLL,
  });
  stillWandering(firstBloom.snapshot, "its first charge-up reached a bloom");
  assertEqual(
    firstBloom.hit,
    true,
    `the first charge-up reached its bloom within ${CHARGE_MAX} s`,
  );
  const firstQuiet = await h.until((snap) => !blooming(snap), {
    maxTicks: ticks(BLOOM_MAX),
    poll: FLARE_WAIT_POLL,
  });
  stillWandering(firstQuiet.snapshot, "its first bloom ended");
  assertEqual(
    firstQuiet.hit,
    true,
    `the first bloom ended within ${BLOOM_MAX} s`,
  );
  const secondCharge = await h.until(charging, {
    maxTicks: ticks(NEXT_FLARE_MAX),
    poll: CYCLE_POLL,
  });
  stillWandering(secondCharge.snapshot, "it charged up a second time");
  assertEqual(
    secondCharge.hit,
    true,
    `a second charge-up began within ${NEXT_FLARE_MAX} s of the first bloom ` +
      `ending`,
  );

  // On camera: the second charge-up running into its bloom, and the bloom out.
  const cycle = await captureReplay(h, "flare", async () => {
    // The charge-up flag, read near the far end of the window it fills.
    await h.advance(ticks(FLARE_CHARGE) - CHARGE_HELD_MARGIN);
    const heldCharge = await h.snapshot();
    const bloom = await h.until(blooming, {
      maxTicks: ticks(CHARGE_MAX),
      poll: FLARE_POLL,
    });
    // And the bloom flag, the same way.
    await h.advance(ticks(FLARE_BLOOM) - BLOOM_HELD_MARGIN);
    const heldBloom = await h.snapshot();
    const quiet = await h.until((snap) => !blooming(snap), {
      maxTicks: ticks(BLOOM_MAX),
      poll: FLARE_POLL,
    });
    await h.advance(TAIL_TICKS);
    return { heldCharge, bloom, heldBloom, quiet };
  });

  requireSceneHeld(await h.snapshot(), guard);

  // Charge then bloom, in that order: the charge-up window is its own.
  assertEqual(
    fish(secondCharge.snapshot).flaring,
    false,
    "the Flarefish is charging and not yet blooming when the charge-up begins",
  );
  assertEqual(
    fish(cycle.heldCharge).flareCharging,
    true,
    `the Flarefish is still charging up ${ticks(FLARE_CHARGE) - CHARGE_HELD_MARGIN} ` +
      `ticks in, of the ${ticks(FLARE_CHARGE)} FLARE_CHARGE (${FLARE_CHARGE} s) ` +
      `runs for`,
  );
  assertEqual(
    fish(cycle.heldCharge).flaring,
    false,
    "the Flarefish has not begun blooming while its charge-up still runs",
  );
  assertEqual(
    fish(cycle.heldBloom).flaring,
    true,
    `the Flarefish is still blooming ${ticks(FLARE_BLOOM) - BLOOM_HELD_MARGIN} ` +
      `ticks in, of the ${ticks(FLARE_BLOOM)} FLARE_BLOOM (${FLARE_BLOOM} s) ` +
      `burns for`,
  );
  stillWandering(cycle.bloom.snapshot, "its second charge-up reached a bloom");
  assertEqual(
    cycle.bloom.hit,
    true,
    `the second charge-up reached its bloom within ${CHARGE_MAX} s`,
  );
  assertEqual(
    cycle.quiet.hit,
    true,
    `the second bloom ended within ${BLOOM_MAX} s`,
  );

  assertLessThanOrEqual(
    Math.abs(
      cycle.bloom.snapshot.simTime -
        secondCharge.snapshot.simTime -
        FLARE_CHARGE,
    ),
    BEAT_TOLERANCE,
    `how far the charge-up ran from the FLARE_CHARGE (${FLARE_CHARGE} s) ` +
      `specs/predators/flarefish.md gives it`,
  );
  assertLessThanOrEqual(
    Math.abs(
      cycle.quiet.snapshot.simTime - cycle.bloom.snapshot.simTime - FLARE_BLOOM,
    ),
    BEAT_TOLERANCE,
    `how far the bloom burned from the FLARE_BLOOM (${FLARE_BLOOM} s) ` +
      `specs/predators/flarefish.md gives it`,
  );
  assertLessThanOrEqual(
    Math.abs(
      secondCharge.snapshot.simTime -
        firstCharge.snapshot.simTime -
        CHARGE_TO_CHARGE,
    ),
    CYCLE_TOLERANCE,
    `how far consecutive charge-ups sat from the ${CHARGE_TO_CHARGE} s ` +
      `specs/predators/flarefish.md gives them — FLARE_INTERVAL ` +
      `(${FLARE_INTERVAL} s) reloaded as the bloom ended, after a ` +
      `${FLARE_CHARGE} s charge and a ${FLARE_BLOOM} s bloom`,
  );
});
