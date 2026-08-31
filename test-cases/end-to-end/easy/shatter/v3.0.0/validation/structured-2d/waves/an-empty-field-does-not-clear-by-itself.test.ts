// waves/an-empty-field-does-not-clear-by-itself — a field emptied without a
// destruction is a wave being played, not a wave cleared.
//
// THE RULE. `specs/progression.md`, "Clearing a wave": "A wave clears on the tick
// in which the last rock on the field is destroyed. It is a transition, not a
// condition on the field: a field that holds no rocks and has had none destroyed
// on that tick is a wave being played, not a wave cleared. Destroying rocks is
// the only way a wave clears". `specs/instrumentation.md` on `clearRocks()`: "It
// destroys nothing and scores nothing, so a field it emptied has had no rock
// destroyed on that tick."
//
// WHAT IS MEASURED. `waveBanner`, `wave` and the rock roster over ten seconds of
// game time after a field holding three rocks is EMPTIED with `clearRocks()`,
// with the game's own wave loop running throughout. None of the three may move.
//
// THIS IS THE ONE CHECK IN THIS GROUP THAT USES `clearRocks`, and it is why the
// operation exists in the shape it does. Every other check here shoots its field
// down (`./scene.ts`), because a build that raises its next wave from the
// destruction event is conformant and a `clearRocks` route would fail it. This
// check is the mirror: it establishes that the emptiness alone buys nothing.
//
// WHY BOTH DIRECTIONS ARE LOAD-BEARING, AND WHY THEY ARE TWO ITEMS. A build that
// polls "no rocks on the field" and a build that never clears at all are
// indistinguishable on `clears-on-last-rock` alone — the first passes it, and so
// would a build that raised a banner for any reason whatever. Read with this
// item, the pair separates them: the poller passes `clears-on-last-rock` and
// fails here, the build that never clears fails there and passes here, and only a
// build that clears on the transition passes both.
//
// AND WHY IT MATTERS TO THE REST OF THE SUITE. The empty quiet field
// `startPlaying` poses — which almost every mechanical check in this case stands
// on — is only safe because of this rule. A build that clears on an empty
// predicate raises a banner and puts a wave up underneath every one of those
// checks. This item is where that build loses its point, rather than losing forty
// scattered ones for reasons none of them are named for.
//
// TEN SECONDS. The review item states it, and it is six and a half times
// `WAVE_BANNER_TIME` (`1.5` s): long enough that a build which clears on the
// empty predicate has time to raise a banner, run it out, spawn a wave, and be
// well into the next one. Sampled EVERY TICK rather than at the end, because a
// banner that went up and ran out inside the window would leave a final reading
// indistinguishable from one that never rose.
//
// THE POSE. Three rocks, spread apart and posed at rest, are put up and given a
// tick to live so the field genuinely held a wave; then `clearRocks()` takes them
// off without destroying any. The rocks are `small`, so a build that somehow
// destroyed one during that single tick would empty the field rather than
// splitting it, and the check would be reading the same emptiness by a different
// road. The ship's lethal contact is off and no round is ever fired, so nothing
// in the window can destroy anything.

import { afterEach, beforeEach, it } from "vitest";
import { WAVE_BANNER_TIME } from "../../src/constants";
import { assertEqual, assertLength, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  sampleEvery,
  ticksFor,
  type Harness,
} from "../harness";
import { openWaveAt } from "./scene";

/** The wave the field is posed at, and which must still be the wave at the end. */
const WAVE = 3;

/** Three places, far apart and far from the star, for the rocks that are emptied away. */
const ROCKS: readonly (readonly [number, number])[] = [
  [200, 150],
  [1080, 150],
  [200, 570],
];

/** The window the review item states: ten seconds of game time, sampled every tick. */
const WATCH_TICKS = ticksFor(10);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("raises no banner and advances no wave over a field clearRocks emptied", async () => {
  openWaveAt(h, WAVE);
  for (const [x, y] of ROCKS) poseRock(h, "small", x, y);

  // One tick with the rocks up, so the field genuinely held a wave before it was
  // emptied — and so a build that keeps a "the field has held rocks" flag has
  // seen them.
  await h.advance(1);
  const held = h.snapshot();
  assertLength(
    held.rocks,
    ROCKS.length,
    "the posed rocks on the field before it is emptied " +
      "(specs/instrumentation.md: addRock)",
  );
  assertEqual(
    held.waveSpawning,
    true,
    "the game's own wave loop running throughout, so the ten quiet seconds " +
      "below are a wave loop declining to clear rather than one switched off " +
      "(specs/instrumentation.md: setWaveSpawning)",
  );
  assertEqual(
    held.waveBanner,
    0,
    "no banner showing before the field is emptied " +
      "(specs/instrumentation.md: setWaveBanner)",
  );

  // The emptying: no rock is destroyed, nothing is scored.
  h.debug.clearRocks();

  const watch = await sampleEvery(h, WATCH_TICKS, 1, (s) => ({
    banner: s.waveBanner,
    wave: s.wave,
    rocks: s.rocks.length,
  }));
  // The emptied field, still playing rather than cleared.
  captureStill(h, "quiet");

  const loudest = watch.reduce((a, b) => (b.banner > a.banner ? b : a));
  assertLessThanOrEqual(
    loudest.banner,
    0,
    `no WAVE N banner at any tick over ${String(WATCH_TICKS / ticksFor(1))} ` +
      `seconds after clearRocks emptied the field — clearRocks destroys ` +
      `nothing, and a field that holds no rocks and has had none destroyed is ` +
      `a wave being played rather than a wave cleared (specs/progression.md, ` +
      `specs/instrumentation.md); WAVE_BANNER_TIME is ` +
      `${String(WAVE_BANNER_TIME)} s, so a banner raised anywhere in the ` +
      `window would still be showing at several of these samples`,
  );

  const highest = watch.reduce((a, b) => (b.wave > a.wave ? b : a));
  assertEqual(
    highest.wave,
    WAVE,
    `the wave number holding at ${String(WAVE)} at every tick — the wave ` +
      `number advances on the tick a wave clears, and destroying rocks is the ` +
      `only way a wave clears (specs/progression.md)`,
  );

  const fullest = watch.reduce((a, b) => (b.rocks > a.rocks ? b : a));
  assertEqual(
    fullest.rocks,
    0,
    "the field staying empty at every tick — no wave was cleared, so no wave " +
      "is announced and none is spawned (specs/progression.md)",
  );
});
