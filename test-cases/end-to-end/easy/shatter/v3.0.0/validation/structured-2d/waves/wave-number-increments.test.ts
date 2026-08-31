// waves/wave-number-increments — the wave a clear announces is exactly one more
// than the wave that was cleared.
//
// THE RULE. `specs/progression.md`, "The banner": "On the tick a wave clears, the
// wave number advances by one and a `WAVE N` banner appears, naming the wave
// about to start."
//
// WHAT IS MEASURED. `wave` from the snapshot, read while the banner raised by a
// real clear is showing, against the wave the field was posed at. THE NUMBER
// ALONE: that a banner goes up at all is `clears-on-last-rock`'s point, how long
// it runs is `banner-runs-for-1p5s`'s, and the fact that text naming the number is
// DRAWN over the field is `presentation/wave-banner-is-drawn`'s. A build that
// advances the wave by two loses this point and keeps those.
//
// WHY THE WAVE IS POSED AT FOUR AND NOT AT ONE. `reset` leaves the wave at `0` and
// a game opens at `1`, so a build that ignores the field entirely and simply
// counts its clears reads `2` after one clear from either. Posed at `4`, a build
// that advances by one reads `5`, a build that counts its own clears from the
// start of the game reads `1`, a build that doubles reads `8`, and a build that
// advances by two reads `6`: every wrong model reads as a different number.
//
// THE READING IS TAKEN WHILE THE BANNER IS UP, which is the moment the rule names
// — the wave number advances on the tick the wave clears, and the banner names
// the wave about to start. Reading it after the banner had run out would be
// reading the wave that is being PLAYED, which a build could reach by advancing
// the number when it spawns rather than when it clears.
//
// THE CLEAR IS A REAL KILL. The last rock is destroyed by a round placed on its
// doorstep and resolved by the build's own collision code (`./scene.ts`), never
// by `clearRocks`, which `specs/instrumentation.md` says destroys nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { clearTheWave, openWaveAt } from "./scene";

/**
 * The wave the field is posed at, and the wave the banner must then announce.
 *
 * Four rather than one, so a build that counts its own clears from the start of
 * the game rather than reading the field's wave number reads a different figure.
 */
const WAVE = 4;
const ANNOUNCED = WAVE + 1;

/**
 * How many ticks after the kill the wave number may have advanced.
 *
 * ONE, on exactly the reasoning `clears-on-last-rock` gives: `specs/simulation.md`
 * fixes the six steps inside a tick and puts collision resolution last, and says
 * nothing about where the wave loop's notice of the destruction sits among them.
 */
const ADVANCE_LATE_TICKS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("announces exactly one wave more than the wave that cleared", async () => {
  openWaveAt(h, WAVE);

  assertEqual(
    h.snapshot().wave,
    WAVE,
    `the field posed at wave ${String(WAVE)} before the clear, so the number ` +
      `read after it is the one the clear produced ` +
      `(specs/instrumentation.md: setWave)`,
  );

  await clearTheWave(h);
  await h.advance(ADVANCE_LATE_TICKS);
  const announced = h.snapshot();
  // The banner announcing the next wave by number.
  captureStill(h, "banner");

  // The reading has to be taken with a banner up, or it says nothing about what
  // the clear announced. That a banner rises at all is `clears-on-last-rock`'s
  // item; here it is the precondition of the number being read.
  assertGreaterThan(
    announced.waveBanner,
    0,
    "a banner showing when the wave number is read, since the number this " +
      "item is about is the one the banner announces (specs/progression.md); " +
      "a build that raises no banner is decided by waves/clears-on-last-rock",
  );

  assertEqual(
    announced.wave,
    ANNOUNCED,
    `wave ${String(ANNOUNCED)} announced by the banner a cleared wave ` +
      `${String(WAVE)} raised — the wave number advances by one on the tick a ` +
      `wave clears, and the banner names the wave about to start ` +
      `(specs/progression.md)`,
  );
});
