// waves/wave-n-spawns-three-plus-n — a later wave puts up three more rocks than
// its own number.
//
// THE RULE. `specs/progression.md`, "Waves": "Wave `N` spawns
// `WAVE_BASE_ROCKS + N` (`3 + N`) Large rocks, so wave 1 puts up four and wave 2
// puts up five."
//
// WHAT IS MEASURED. The rock roster on the tick the wave that follows a cleared
// wave 6 arrives, against `WAVE_BASE_ROCKS + 7` (`10`). THE SLOPE, which is what
// separates this item from `wave-one-spawns-four`: that item reads the base of
// the rule at the game's own opening, and this one reads a wave far enough along
// that a build which spawns a constant number, or scales by the wrong step, reads
// a different figure.
//
// AND WHY EVERY WRONG MODEL READS AS A DIFFERENT NUMBER. A build that spawns a
// constant four reads `4`. A build that spawns `N` rather than `3 + N` reads `7`.
// A build that spawns `3 + N` for the wave it just CLEARED rather than for the one
// it announces reads `9`. A build that doubles reads `20`. The specified answer is
// `10`, and none of the four is near it.
//
// THE COUNT IS READ AGAINST THE WAVE THE BUILD SAYS IT SPAWNED. That the wave
// number advances by one is `wave-number-increments`'s rule and its item; this one
// is `WAVE_BASE_ROCKS + N`. A build that advances by two spawns wave 8 and owes
// eleven rocks, and it should lose the increment point rather than this one as
// well. What that does NOT let through is a build that spawns a constant number:
// its reported wave has to agree with its count for every wave, and
// `wave-one-spawns-four` pins the same rule at the other end of the scale.
//
// WHY WAVE SEVEN. It has to be a wave whose count differs from the wave before it
// and from every simple mis-reading of the rule, and it has to be reachable by ONE
// clear so the check reads a wave the build spawned rather than one it grew into
// over six clears — `setWave` poses the number and the clear does the rest
// (`specs/instrumentation.md`: "`setWave(n)` sets the current wave number. It
// spawns no rocks and clears none").
//
// ONE GAME, for the reason `wave-one-spawns-four` gives: the count is exact and
// the world is generated once. A ten-rock wave crowds `specs/progression.md`'s
// placement rules harder than a four-rock one, which is why the later wave is
// the one this item poses.
//
// THE CLEAR IS A REAL KILL, through `./scene.ts`, never `clearRocks`.
//
// WHAT THIS ITEM DOES NOT DECIDE. WHERE the ten stand, which is
// `spawns-clear-of-the-ship`'s and `spawns-clear-of-the-star`'s, how fast they
// drift, which is `speed-scales-per-wave`'s, and WHEN they arrive, which is
// `spawns-as-the-banner-ends`'s.

import { afterEach, beforeEach, it } from "vitest";
import { WAVE_BASE_ROCKS } from "../constants";
import { assertLength } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { clearTheWave, openWaveAt, rocksInWave, waitForTheWave } from "./scene";

/** The wave the field is posed at, so a conformant build then spawns wave 7. */
const WAVE = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts up WAVE_BASE_ROCKS + N Large rocks for a later wave", async () => {
  openWaveAt(h, WAVE);
  await clearTheWave(h);
  const arrival = await waitForTheWave(h);
  // The wave as it arrived, kept before the assertions so a failing build
  // leaves the picture that shows why.
  captureStill(h, "wave");

  // Read against the wave the BUILD says it spawned, so this item decides the
  // count rule alone. A build whose wave number advances by two is wrong about
  // a different rule, and waves/wave-number-increments is the item for it.
  const spawned = arrival.at.wave;
  assertLength(
    arrival.rocks,
    rocksInWave(spawned),
    `wave ${String(spawned)} putting up ` +
      `WAVE_BASE_ROCKS (${String(WAVE_BASE_ROCKS)}) + ${String(spawned)} = ` +
      `${String(rocksInWave(spawned))} rocks — wave N spawns ` +
      `WAVE_BASE_ROCKS + N Large rocks (specs/progression.md); the field was ` +
      `posed at wave ${String(WAVE)} and cleared, and the count is read ` +
      `against the wave the build reported spawning, so a build whose wave ` +
      `number does not advance by one loses ` +
      `waves/wave-number-increments rather than this point`,
  );

  const wrongSize = arrival.rocks.filter((rock) => rock.size !== "large");
  assertLength(
    wrongSize,
    0,
    `every rock of wave ${String(spawned)} a Large — a wave spawns Large ` +
      `rocks (specs/progression.md); found ` +
      `${wrongSize.map((rock) => rock.size).join(", ")}`,
  );
});
