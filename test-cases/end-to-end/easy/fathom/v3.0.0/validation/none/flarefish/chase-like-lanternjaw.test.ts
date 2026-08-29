// flarefish/chase-like-lanternjaw — a chasing Flarefish gives off no tell at all,
// runs at the Lanternjaw's hunting pace, and re-arms a whole interval when it
// gives up.
//
// `specs/predators/flarefish.md`: "A chasing Flarefish neither charges nor blooms,
// so it gives off no tell at all while it hunts"; "The Flarefish travels at
// `PREDATOR_SPEED` (`116`) in every state"; and "Returning to `"wander"`, by the
// linger running out or by ink, sets the flare timer to `FLARE_INTERVAL` in full,
// so the next flare is a whole interval away and the forager has a window to get
// clear."
//
// THE FLARE TIMER'S READING IS KNOWN WHEN THE CHASE OPENS, which is what makes
// both of the flare claims decidable rather than merely likely.
// `specs/predators/flarefish.md` fixes one instant exactly — "the timer restarts at
// `FLARE_INTERVAL` (`7 s`) as the bloom ends" — so this waits out a whole flare in
// the same corridor and then spends part of that interval wandering before the
// chase opens. Two things follow. A build that keeps its timer running through a
// chase charges up inside a window held longer than a whole interval; and a build
// that never re-arms on returning to wander is holding the REMAINDER rather than
// the interval, which is a different number from the one the page names.
//
// THE CHASE IS HELD BY A RETREATING FORAGER, because it cannot be held any other
// way. The sense needs line of sight and a distance inside `R`, so the hunter is
// always closing; a forager that stands still is caught in the two or three
// seconds its own light-range buys, and the item's stretch is longer than that.
// One straight corridor thirty-four tiles long, with the forager grazing its way
// down it at `FORAGER_SPEED` (`128`) against the hunter's `116`, holds line of
// sight the whole way and opens the gap by twelve units a second — from two tiles
// to four, never past the `R` the grazing keeps at its widest.
//
// THE SPEED IS READ FROM GROUND COVERED, mid-run, over four and a half seconds of
// one unbroken straight line: no turn, no reversal and no acquisition transient
// inside the window, so what it measures is the pace and nothing else.
//
// AND THE RE-ARM IS EARNED, NOT POSED. The forager is put back in a sealed pocket
// eight tiles below the corridor — past `FLARE_RADIUS` and behind seven rows of
// solid rock, so neither of the Flarefish's reaches finds it — and the hunter then
// loses the fix through the build's own linger. The interval is timed from the
// moment it reports `"wander"`.
//
// WHAT THIS DOES NOT DECIDE. How long the linger runs, which is
// `lanternjaw/dim-shakes`'s; and the cadence of the flares themselves, which is
// `flarefish/flare-cadence`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  ARROW_KEY,
  FLARE_INTERVAL,
  FLARE_RADIUS,
  PREDATOR_SPEED,
  TICK_HZ,
} from "../constants";
import { poseMaze, predatorIndex } from "../fixtures";
import {
  captureReplay,
  createHarness,
  ticks,
  type FathomSnapshot,
  type Harness,
} from "../harness";
import {
  denAllExcept,
  parkForager,
  requirePredatorMotion,
  requireSceneHeld,
  sceneGuard,
  startPlaying,
} from "../scene";
import { BLOOM_MAX, FIRST_FLARE_MAX, FLARE_POLL } from "./room";

/** How many tiles of corridor the chase runs down. */
const RUN_TILES = 34;

/**
 * The board: one long straight corridor, and eight tiles below it a sealed pocket.
 *
 * `C` is the corridor's left end, where the hunter starts and the forager is put
 * two tiles ahead of it; `W` is the pocket the forager retreats to when the chase
 * has been held long enough. Eight tiles is `256` units, past `FLARE_RADIUS`
 * (`192`), and the seven rows of rock between break the line of sight the ordinary
 * light-sense needs — so neither of the Flarefish's two reaches finds the forager
 * once it is in there.
 */
const ART = [
  "C" + ".".repeat(RUN_TILES - 1),
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "W..",
] as const;

/** How far below the corridor the sealed pocket sits, in tiles. */
const POCKET_ROWS = 8;

/** How far ahead of the hunter the forager starts the run, in tiles. */
const HEAD_START = 2;

/**
 * How long the chase is held, in seconds.
 *
 * Eight, against the `FLARE_INTERVAL` (`7 s`) the timer carried into it. A build
 * that runs its flare timer through a chase has therefore had a whole interval to
 * charge up inside the window, with a second to spare.
 */
const CHASE_SECONDS = 8;

/**
 * How much of the reloaded flare timer is spent wandering before the chase opens,
 * in seconds.
 *
 * THIS IS WHAT MAKES THE RE-ARM DECIDABLE. The timer does not run during a chase,
 * so a chase opened the instant a bloom ended would leave a build that never
 * re-arms holding exactly the `FLARE_INTERVAL` a build that does re-arms to — and
 * the two would be indistinguishable. Three seconds of wandering first leaves four
 * on the clock, so a build that carries that remainder through the chase charges up
 * four seconds after returning to wander and a build that re-arms takes seven.
 *
 * It costs the no-tell half nothing: the chase is held longer than a whole
 * interval, so it outlasts a timer holding four seconds and one holding seven
 * alike.
 */
const SPEND_SECONDS = 3;

/** Ticks the pair is given for the hunter's own sense to take the fix. */
const ACQUIRE_TICKS = 12;

/** How often the two flare flags are read during the chase, in ticks. */
const SAMPLE_TICKS = 6;

/**
 * The window the pace is measured over, in ticks from the start of the chase.
 *
 * Two seconds in to six and a half: past the acquisition and its reversal, and
 * well short of the end of the corridor, so the whole of it is one straight
 * unbroken run.
 */
const SPEED_FROM = 240;
const SPEED_TO = 780;

/**
 * How far the measured pace may sit from `PREDATOR_SPEED`, as a fraction.
 *
 * The item's bound: two percent. Ground covered over four and a half seconds
 * against a speed the page states flatly, so this is room for a build's own
 * integration and nothing else.
 */
const SPEED_TOLERANCE = 0.02;

/** How long the hunter is given to give the fix up once the forager is gone. */
const GIVE_UP_MAX = 6;

/** How long the next charge-up is then waited for, in seconds. */
const REARM_MAX = FLARE_INTERVAL + 2.5;

/**
 * How far the re-armed interval may sit from `FLARE_INTERVAL`, in seconds.
 *
 * A fifth of a second, the band `flarefish/flare-cadence` states for a whole
 * interval, and a fiftieth of the seven seconds being measured.
 */
const REARM_TOLERANCE = 0.2;

let h: Harness;

beforeEach(async (ctx) => {
  h = await createHarness(ctx);
});

afterEach(async () => {
  await h.dispose();
});

it("neither charges nor blooms across a chase longer than FLARE_INTERVAL, travels at PREDATOR_SPEED, and re-arms a whole interval on returning to wander", async () => {
  await startPlaying(h);
  const board = await poseMaze(h, ART);
  const runStart = board.mark("C");
  const pocket = board.mark("W");
  await parkForager(h, pocket);
  await h.debug.setBrightness(0);

  const opening = await h.snapshot();
  const index = predatorIndex(opening, "flarefish");
  if (index === null) {
    h.unmet(
      "the roster carries no Flarefish, so there is no chase to read — what " +
        "the roster holds is the progression checks' verdict, not this one's",
    );
  }
  const quiet = await denAllExcept(h, [index]);
  await h.debug.setPredatorTile(index, runStart.tx, runStart.ty);
  await h.debug.setPredatorDir(index, "right");
  await h.debug.setPredatorState(index, "wander");
  // The forager is the thing that moves here, so the guard watches everything
  // about the scene except where it stands.
  const guard = await sceneGuard(h, quiet, { foragerParked: false });

  const fish = (snap: FathomSnapshot): FathomSnapshot["predators"][number] =>
    snap.predators[index];

  // A whole flare, waited out in the corridor, so the chase below opens on a timer
  // the specification says is full.
  const bloom = await h.until((snap) => fish(snap).flaring === true, {
    maxTicks: ticks(FIRST_FLARE_MAX),
    poll: FLARE_POLL,
  });
  const reloaded = await h.until((snap) => fish(snap).flaring !== true, {
    maxTicks: ticks(BLOOM_MAX),
    poll: FLARE_POLL,
  });
  if (!bloom.hit || !reloaded.hit) {
    h.unmet(
      `the Flarefish did not complete a flare within ` +
        `${FIRST_FLARE_MAX + BLOOM_MAX} s of patrolling the corridor, so the ` +
        `chase below could not be opened on a timer known to be full — whether ` +
        `it flares on its interval is flarefish/flare-cadence's verdict, not ` +
        `this one's`,
    );
  }

  // Part of the reloaded interval, spent wandering, so the remainder the chase
  // carries is known and is NOT the figure a re-arm would produce.
  await h.advance(ticks(SPEND_SECONDS));

  const run = await captureReplay(h, "chase", async () => {
    // Both bodies to the corridor's left end, the forager two tiles ahead. No tick
    // runs across these poses, so the timer is still the full interval the bloom
    // just reloaded.
    await h.debug.setPredatorTile(index, runStart.tx, runStart.ty);
    await h.debug.setPredatorDir(index, "right");
    await h.debug.setForagerTile(runStart.tx + HEAD_START, runStart.ty);
    await h.debug.setForagerDir("right");
    const key = ARROW_KEY.right;
    await h.hold(key);
    await h.advance(ACQUIRE_TICKS);
    const acquired = await h.snapshot();

    const flags: { at: number; charging: boolean; flaring: boolean }[] = [];
    const states: string[] = [];
    let from: FathomSnapshot | null = null;
    let to: FathomSnapshot | null = null;
    for (
      let at = ACQUIRE_TICKS;
      at < ticks(CHASE_SECONDS);
      at += SAMPLE_TICKS
    ) {
      await h.advance(SAMPLE_TICKS);
      const snap = await h.snapshot();
      const now = at + SAMPLE_TICKS;
      flags.push({
        at: now,
        charging: fish(snap).flareCharging === true,
        flaring: fish(snap).flaring === true,
      });
      states.push(fish(snap).state);
      if (now === SPEED_FROM) from = snap;
      if (now === SPEED_TO) to = snap;
    }
    await h.release(key);

    // The forager to its sealed pocket, which is how the fix goes stale.
    await parkForager(h, pocket);
    const dropped = await h.until((snap) => fish(snap).state === "wander", {
      maxTicks: ticks(GIVE_UP_MAX),
      poll: FLARE_POLL,
    });
    const charged = await h.until((snap) => fish(snap).flareCharging === true, {
      maxTicks: ticks(REARM_MAX),
      poll: FLARE_POLL,
    });
    return { acquired, flags, states, from, to, dropped, charged };
  });

  requireSceneHeld(h, await h.snapshot(), guard);

  // The premise: the hunter's own sense took the fix, and held it for the whole
  // window. Both are `flarefish/light-sense`'s claim rather than this one's.
  if (fish(run.acquired).state !== "chase") {
    h.unmet(
      `the Flarefish did not fix on a forager ${HEAD_START} tiles down a ` +
        `straight corridor in clear line of sight, so there was no chase to ` +
        `read — whether its light-sense holds inside R is ` +
        `flarefish/light-sense's verdict, not this one's`,
    );
  }
  const lapsed = run.states.filter((state) => state !== "chase");
  if (lapsed.length > 0) {
    h.unmet(
      `the Flarefish left its chase (${lapsed[0]}) during the ` +
        `${CHASE_SECONDS} s the forager was retreating down one straight ` +
        `corridor in clear line of sight — whether its sense holds inside R is ` +
        `flarefish/light-sense's verdict, not this one's`,
    );
  }
  if (run.from === null || run.to === null) {
    h.unmet(
      "the chase window closed before the pace could be read across it, so " +
        "there is no ground covered to measure",
    );
  }
  requirePredatorMotion(
    h,
    run.from,
    run.to,
    index,
    "chase the retreating forager down the corridor",
  );

  // No tell, across a stretch longer than the interval its timer was carrying.
  const told = run.flags.filter((flag) => flag.charging || flag.flaring);
  assertEqual(
    told.length,
    0,
    `steps of the ${CHASE_SECONDS} s chase on which the Flarefish reported a ` +
      `charge-up or a bloom, of ${run.flags.length} read — its timer stood at ` +
      `${FLARE_INTERVAL - SPEND_SECONDS} s when the chase opened, of the ` +
      `FLARE_INTERVAL (${FLARE_INTERVAL} s) the bloom before it reloaded` +
      (told.length > 0
        ? `; the first was ${told[0].at} ticks in, charging=${told[0].charging} ` +
          `flaring=${told[0].flaring}`
        : ""),
  );

  // The pace, from ground covered over one unbroken straight run.
  const covered = Math.hypot(
    fish(run.to).x - fish(run.from).x,
    fish(run.to).y - fish(run.from).y,
  );
  const pace = (covered * TICK_HZ) / (SPEED_TO - SPEED_FROM);
  assertLessThanOrEqual(
    Math.abs(pace - PREDATOR_SPEED) / PREDATOR_SPEED,
    SPEED_TOLERANCE,
    `how far the chasing Flarefish's pace (${pace.toFixed(1)} units a second, ` +
      `from ${covered.toFixed(1)} units over ${SPEED_TO - SPEED_FROM} ticks) ` +
      `sat from the PREDATOR_SPEED (${PREDATOR_SPEED}) ` +
      `specs/predators/flarefish.md gives it in every state, as a fraction`,
  );

  // And the re-arm: a whole interval from the moment it went back to wandering.
  assertEqual(
    run.dropped.hit,
    true,
    `the Flarefish gave the fix up within ${GIVE_UP_MAX} s of the forager ` +
      `retreating ${POCKET_ROWS} tiles below it, behind solid rock and past ` +
      `FLARE_RADIUS (${FLARE_RADIUS})`,
  );
  assertEqual(
    run.charged.hit,
    true,
    `the Flarefish charged up again within ${REARM_MAX} s of returning to ` +
      `wander`,
  );
  assertLessThanOrEqual(
    Math.abs(
      run.charged.snapshot.simTime -
        run.dropped.snapshot.simTime -
        FLARE_INTERVAL,
    ),
    REARM_TOLERANCE,
    `how far the gap between returning to wander and the next charge-up sat ` +
      `from the FLARE_INTERVAL (${FLARE_INTERVAL} s) ` +
      `specs/predators/flarefish.md sets the timer to in full`,
  );
});
