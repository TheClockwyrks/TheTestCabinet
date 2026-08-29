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
} from "../harness";
import { requireSceneHeld, sceneGuard, startPlaying } from "../scene";
import {
  BLOOM_MAX,
  CHARGE_MAX,
  FIRST_FLARE_MAX,
  FLARE_POLL,
  NEXT_FLARE_MAX,
  poseFlareRoom,
} from "./room";

/**
 * How far a measured beat may sit from the figure the specification gives it, in
 * seconds.
 *
 * The item's own bounds: a tenth of a second for the charge and the bloom, a
 * fifth for the gap between consecutive charge-ups, which is the sum of three
 * figures and so carries three beats' worth of a build's own rounding. The sweeps
 * resolve an edge to `FLARE_POLL` ticks, a sixtieth of a second, so all but a
 * sixth of the tighter band is room for the build.
 */
const BEAT_TOLERANCE = 0.1;
const CYCLE_TOLERANCE = 0.2;

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
 * How long after each flag is first SEEN it is read again, in ticks.
 *
 * The gap between two onsets says when a beat ended and nothing about whether the
 * flag stayed up across it: a build whose `flareCharging` falls after a frame and
 * whose bloom still opens on time satisfies every onset this check times and gives
 * the player none of the telegraph `specs/predators/flarefish.md` describes. So
 * each flag is also read near the far end of the window it is stated to fill —
 * short of that end by the sweep's own resolution and a tick, so the reading is
 * inside the window under any reading of which tick the flag rose on.
 */
const HELD_MARGIN = FLARE_POLL + 2;

/** Ticks held after the second bloom ends, so the clip shows it finish. */
const TAIL_TICKS = 60;

let h: Harness;

beforeEach(async (ctx) => {
  h = await createHarness(ctx);
});

afterEach(async () => {
  await h.dispose();
});

it("charges for FLARE_CHARGE, blooms for FLARE_BLOOM, and charges again a whole FLARE_INTERVAL after the bloom ends", async () => {
  await startPlaying(h);
  const room = await poseFlareRoom(h);
  const guard = await sceneGuard(h, room.quiet);

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
    const state = fish(snap).state;
    if (state === "wander") return;
    h.unmet(
      `the Flarefish left its wander (${state}) before ${what}, from a sealed ` +
        `hallway eleven tiles from a forager at G = 0 — whether its sense holds ` +
        `only inside R is flarefish/light-sense's verdict, not this one's`,
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
    poll: FLARE_POLL,
  });
  stillWandering(firstCharge.snapshot, "it first charged up");
  assertEqual(
    firstCharge.hit,
    true,
    `a wandering Flarefish charged up within ${FIRST_FLARE_MAX} s`,
  );
  const firstBloom = await h.until(blooming, {
    maxTicks: ticks(CHARGE_MAX),
    poll: FLARE_POLL,
  });
  stillWandering(firstBloom.snapshot, "its first charge-up reached a bloom");
  assertEqual(
    firstBloom.hit,
    true,
    `the first charge-up reached its bloom within ${CHARGE_MAX} s`,
  );
  const firstQuiet = await h.until((snap) => !blooming(snap), {
    maxTicks: ticks(BLOOM_MAX),
    poll: FLARE_POLL,
  });
  stillWandering(firstQuiet.snapshot, "its first bloom ended");
  assertEqual(
    firstQuiet.hit,
    true,
    `the first bloom ended within ${BLOOM_MAX} s`,
  );
  const secondCharge = await h.until(charging, {
    maxTicks: ticks(NEXT_FLARE_MAX),
    poll: FLARE_POLL,
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
    await h.advance(ticks(FLARE_CHARGE) - HELD_MARGIN);
    const heldCharge = await h.snapshot();
    const bloom = await h.until(blooming, {
      maxTicks: ticks(CHARGE_MAX),
      poll: FLARE_POLL,
    });
    // And the bloom flag, the same way.
    await h.advance(ticks(FLARE_BLOOM) - HELD_MARGIN);
    const heldBloom = await h.snapshot();
    const quiet = await h.until((snap) => !blooming(snap), {
      maxTicks: ticks(BLOOM_MAX),
      poll: FLARE_POLL,
    });
    await h.advance(TAIL_TICKS);
    return { heldCharge, bloom, heldBloom, quiet };
  });

  requireSceneHeld(h, await h.snapshot(), guard);

  // Charge then bloom, in that order: the charge-up window is its own.
  assertEqual(
    fish(secondCharge.snapshot).flaring,
    false,
    "the Flarefish is charging and not yet blooming when the charge-up begins",
  );
  assertEqual(
    fish(cycle.heldCharge).flareCharging,
    true,
    `the Flarefish is still charging up ${ticks(FLARE_CHARGE) - HELD_MARGIN} ` +
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
    `the Flarefish is still blooming ${ticks(FLARE_BLOOM) - HELD_MARGIN} ` +
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
