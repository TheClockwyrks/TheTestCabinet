// audio/constellation-cue-once-for-a-repeating-product — a set that takes a chain
// of `k` copies sounds `constellation` once, not once per copy.
//
// THE RULE. `specs/ui.md`: "| `constellation` | `CUES.constellation` | A set
// consumes one or more constellations. |", played "on the frame its event
// happens, from `update`, and at most once on that frame, however many of the
// event fired within it". A chain is ONE constellation however many copies it
// holds: "For a repeating product, a constellation is accepted when it is unheld
// and is exactly `k` chained copies of the placed pattern, `k >= REPEAT_MIN`
// (`2`) ... An accepted constellation is consumed whole, and the set's tally
// rises by `1` for a plain product and BY `k` FOR A REPEATING ONE"
// (`specs/sigils.md`). So the tally moves by `k` and the sound does not.
//
// HOW ONE CUE IS TOLD FROM `k`, ON ALL THREE ENGINES. Under either engine the cue
// bus announces a name; under no engine a check can hear only that a frame
// sounded and how much (`scenario.ts`, `cuesOf`). So the reading is a COMPARISON
// between two consumptions of the same set, in the same run, of the same cue: a
// chain of two copies and a chain of three. A build that sounds once per
// consumption sounds the same on both boundaries; a build that sounds once per
// copy sounds half again as much on the second. Neither figure is compared
// against a literal, because what one cue costs a build in sound sources is the
// build's business, and both are of the same cue so the comparison is honest.
//
// THE CONFIGURATION. `REPEATING`, whose one product is a single `luna` on
// `(0, 0)` repeating along `(1, 0)` with a weight-`1` link between consecutive
// copies, opened as a bare run — the completion switch held off — with ONE part
// on the field: the set for product `0` on `ORIGIN`. Each chain is spawned mote
// by mote and joined link by link, at the placed pose: copy `i` on
// `ORIGIN + i * (1, 0)`, consecutive copies joined at weight `1`. Nothing else is
// placed, so no rise refills the hexes and no sigil acts on the chain before the
// set reads it.
//
// THE VERDICT. The two-copy chain raises the tally by `2` and the three-copy
// chain by `3`, so both boundaries really consumed a chain of the size they were
// given — and the two boundaries sound exactly the same.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import { CUES, REPEAT_MIN } from "../constants";
import { at } from "../field";
import { setPart, solution } from "../formats";
import { ORIGIN, REPEATING } from "../fixtures";
import {
  captureReplay,
  createHarness,
  openBareRun,
  spawnConstellation,
  tallyOf,
  watchCues,
  type Harness,
} from "../harness";
import {
  FENCE_FRAMES,
  TAIL_FRAMES,
  driveUntil,
  openSilence,
  soundingFrames,
  soundsOnFrame,
} from "./silence";

/** Which of the challenge's products this set receives. */
const PRODUCT = 0;

/** The two chain lengths, both at least REPEAT_MIN (2) and different from each other. */
const SHORT_CHAIN = REPEAT_MIN;
const LONG_CHAIN = REPEAT_MIN + 1;

/** Spawn `k` copies of the placed pattern, joined consecutively at weight 1. */
function chain(k: number) {
  return {
    motes: Array.from({ length: k }, (_unused, i) => ({
      hex: at(ORIGIN.q + i, ORIGIN.r),
      type: "luna" as const,
    })),
    links: Array.from({ length: k - 1 }, (_unused, i) => ({
      a: i,
      b: i + 1,
      weight: 1,
    })),
  };
}

let h: Harness;

beforeEach(async () => {
  // ARMED AT CREATION, because this suite reads what the build SOUNDED and a
  // browser opens no audio context without a user gesture: unarmed, `openSilence`
  // below would find the page's silence rather than the build's. The press of
  // `INERT_KEY` goes in before the harness's opening `reset`, whose restore puts
  // back anything it touched, so it costs this check nothing — see `silence.ts`.
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("sounds no more for a chain of three copies than for a chain of two", async () => {
  await openBareRun(h, {
    challenge: REPEATING,
    machine: solution([setPart(PRODUCT, ORIGIN.q, ORIGIN.r, 0)]),
  });
  await openSilence(h);

  const heard = watchCues(h);
  await h.advance(FENCE_FRAMES);
  assertLength(
    soundingFrames(heard, CUES.constellation),
    0,
    "an empty field crosses boundaries that consume nothing, so nothing sounds yet",
  );

  const short = chain(SHORT_CHAIN);
  await spawnConstellation(h, short.motes, short.links);
  const before = tallyOf(await h.snapshot(), PRODUCT) ?? 0;
  const shortFrame = await driveUntil(
    h,
    (snapshot) => (tallyOf(snapshot, PRODUCT) ?? 0) > before,
    2,
  );
  assertGreaterThan(
    shortFrame,
    0,
    "the two-copy chain was consumed at a boundary",
  );
  assertEqual(
    tallyOf(await h.snapshot(), PRODUCT),
    before + SHORT_CHAIN,
    "a repeating product's tally rises by k, and this chain is k of 2",
  );
  const oneCue = soundsOnFrame(heard, shortFrame);
  assertGreaterThan(
    oneCue,
    0,
    "that frame really sounded, so the measure is a sound rather than a silence",
  );

  const long = chain(LONG_CHAIN);
  await spawnConstellation(h, long.motes, long.links);
  const midway = tallyOf(await h.snapshot(), PRODUCT) ?? 0;
  const longFrame = await captureReplay(h, "chained", async () => {
    const frame = await driveUntil(
      h,
      (snapshot) => (tallyOf(snapshot, PRODUCT) ?? 0) > midway,
      2,
    );
    await h.advance(TAIL_FRAMES);
    return frame;
  });

  assertGreaterThan(
    longFrame,
    0,
    "the three-copy chain was consumed at a boundary",
  );
  assertEqual(
    tallyOf(await h.snapshot(), PRODUCT),
    midway + LONG_CHAIN,
    "and its tally rose by 3, so the set really took three copies rather than two",
  );
  assertEqual(
    soundsOnFrame(heard, longFrame),
    oneCue,
    "yet it sounds exactly what the two-copy chain sounded: one cue for the consumption, not one per copy",
  );
});
