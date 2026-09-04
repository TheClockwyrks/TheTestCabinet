// modes/hundred-releases-one-hundred — the onslaught is exactly a hundred units,
// released as one continuous wave, and no more arrive after it.
//
// THE RULE. `specs/modes.md`: The Hundred "replaces the wave progression with one
// onslaught ... a single wave of exactly `HUNDRED_UNITS` (`100`) units, released
// at the same `WAVE_SPAWN_INTERVAL` cadence every wave uses", and its table gives
// the mode `1` under Waves.
//
// WHY THE WAVE IS STARTED FOR REAL. The count is not a field a pose can set
// honestly: `setWavePending` sets how many units are still to come, which is the
// very number under test, and `setPhase("wave")` runs no entry effect
// (`specs/instrumentation.md`), so it counts nothing onto the wave. The wave has
// to be BEGUN, and in The Hundred — one untimed opening phase and no build timer
// to run out — the only way to begin it is the send. So the run's own release is
// turned on, which is what makes this one of the items the world gate belongs to,
// and `send` is pressed from the opening phase.
//
// TWO READINGS, AND WHY BOTH.
//
//   THE COUNT THE WAVE OPENED WITH. On the frame the wave begins, one unit is
//   released and the rest are still pending (`specs/waves.md`: "the first on the
//   frame the wave begins"), so the units on the floor plus `wavePending` is the
//   whole onslaught. The surge is empty before the send, so that sum is exactly
//   what the mode counted out. A build that treated the onslaught as an ordinary
//   Wave 1 of a one-wave run reads `1` — a milestone Core — and one that split it
//   into batches reads a batch.
//
//   THE UNITS THAT ACTUALLY ARRIVED. The whole release is then driven and every
//   distinct unit id that appears is collected. It must come to exactly a hundred:
//   a build that counted a hundred onto the wave and released ninety, or released
//   a hundred and then kept going, fails here and passes the first reading. Ids
//   are distinct among live entities and are never reused while the entity holding
//   one is live (`specs/instrumentation.md`), so counting distinct ids counts
//   units.
//
// WHY THE LIVES ARE POSED ENORMOUS. A hundred units crossing an empty floor all
// leak, and the twentieth leak would take the lives to `0` and end the run, which
// would stop the spawner half way through the very thing being counted. The lives
// are a run figure this check is not about — `modes.hundred-figures` decides them
// — so they are posed out of the way rather than defended with towers.
//
// WHAT THIS ITEM DOES NOT DECIDE. The cadence between two releases is
// `surge.spawn-cadence`'s, the types the onslaught cycles are the surge group's,
// and the hp every unit carries is `modes.hundred-hp-factor`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HUNDRED_UNITS, WAVE_SPAWN_INTERVAL } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  tapAction,
  type Harness,
} from "../harness";

/**
 * Lives no leak can exhaust.
 *
 * The costliest onslaught imaginable is a hundred Cores at five lives each, so
 * anything past `500` cannot be spent; this is three orders past that, which
 * makes it unmistakably a pose rather than a figure.
 */
const UNENDING_LIVES = 1_000_000;

/**
 * How much game time the release is followed for, and how much of it is covered
 * between two samples.
 *
 * The window is the whole release plus a wide margin: a hundred units one every
 * `WAVE_SPAWN_INTERVAL` takes `99 * 0.6` seconds, and a further ten seconds is
 * where a build that kept releasing past the hundredth is caught. The sample
 * spacing is well under one interval, and every unit lives for several seconds
 * (the shortest crossing on an empty floor is the Sprint's, some six), so no unit
 * can appear and be gone between two samples. Neither figure is a tolerance: they
 * say how long the release is watched and how often, not how far a build may miss
 * by.
 */
const WATCH_SECONDS = WAVE_SPAWN_INTERVAL * HUNDRED_UNITS + 10;
const SAMPLE_SECONDS = 0.4;
/** Frames of game time per second inside a sample. Coarse, because none is read. */
const SAMPLE_HZ = 30;

/**
 * How far into the release the picture is taken.
 *
 * Far enough in that the floor is visibly carrying an onslaught rather than one
 * unit, and far short of the end, where the last of them have leaked and there is
 * nothing left to see.
 */
const PICTURE_SECONDS = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("counts a hundred units onto one wave and releases exactly those", async () => {
  const { debug } = h;
  await startRun(h, "hundred");
  // The Hundred's one untimed opening phase, which is where a send begins the
  // onslaught, and lives nothing can exhaust.
  await debug.setPhase("opening");
  await debug.setBuildTimer(0);
  await debug.setLives(UNENDING_LIVES);
  // The run's own release: this item IS the release, so the gate belongs on.
  await debug.setWaveSpawning(true);

  await tapAction(h, "send");

  // The frame the wave began: one unit out, the rest pending.
  const opened = await h.snapshot();
  const counted = opened.surge.length + opened.wavePending;

  // Every unit that ever appears, gathered from the samples the sweep takes. The
  // predicate is where the gathering happens because a sample is one crossing
  // into the page and a separate read would double the cost of every one of them.
  const seen = new Set<number>();
  for (const unit of opened.surge) seen.add(unit.id);
  const watch = (duration: number): Promise<unknown> =>
    h.coastUntil(
      (snapshot) => {
        for (const unit of snapshot.surge) seen.add(unit.id);
        return false;
      },
      { maxSeconds: duration, pollSeconds: SAMPLE_SECONDS, hz: SAMPLE_HZ },
    );

  await watch(PICTURE_SECONDS);
  await captureStill(h, "onslaught");
  await watch(WATCH_SECONDS - PICTURE_SECONDS);

  assertEqual(
    counted,
    HUNDRED_UNITS,
    "the units the onslaught counted onto its one wave",
  );
  assertEqual(opened.waveCount, 1, "The Hundred's wave count: one onslaught");
  assertEqual(seen.size, HUNDRED_UNITS, "the units the onslaught released");
});
