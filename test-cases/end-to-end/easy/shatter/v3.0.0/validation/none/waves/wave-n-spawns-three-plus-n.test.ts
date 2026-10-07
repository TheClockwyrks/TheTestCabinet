// waves/wave-n-spawns-three-plus-n — a later wave puts up 3 + N Large rocks.
//
// `specs/progression.md`, Waves: "Wave `N` spawns `WAVE_BASE_ROCKS + N` (`3 + N`)
// Large rocks, so wave 1 puts up four and wave 2 puts up five."
//
// WHY A SECOND ITEM AT ALL. `wave-one-spawns-four` reads the opening wave, where
// `3 + N` and a constant four are the same number. This one reads a wave where they
// are not: the run is posed at wave 6 and shot clear, so the wave that arrives is
// wave 7 and the specification asks for ten. Every plausible wrong model reads as a
// different number — a build that always puts up four reads four, one that adds a
// rock per wave from a base of one reads eight, one that counts from the wave it
// just cleared reads nine, one that doubles reads fourteen — so a failure here
// names which wrong model the build implemented rather than merely saying "not
// ten".
//
// THE CLEARED FIELD IS REACHED BY SHOOTING, never by `clearRocks`. See the note at
// the top of `scenario.ts`: `specs/instrumentation.md` has `clearRocks` destroy
// nothing, so a field it emptied has had no rock destroyed and, by
// `specs/progression.md`'s transition rule, is a wave being played rather than one
// cleared. A build that raises its next wave from the destruction event is
// conformant, and shooting is what lets it pass.
//
// THE SIZES ARE READ TOO, for the reason `wave-one-spawns-four` gives: ten rocks of
// the wrong size is a wave of the wrong size made of the wrong thing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { waveRockCount } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { arrivedWave, clearAWave, describeRock } from "./scenario";

/**
 * The wave the run is posed at, and the wave clearing it announces.
 *
 * Six, the review item's own figure: high enough that `WAVE_BASE_ROCKS + N`, a
 * constant, and a count taken from the wave just cleared are three different
 * numbers, and low enough that the arriving wave is ten rocks rather than a field
 * a check would spend a minute reading.
 */
const POSED_WAVE = 6;
const ARRIVING_WAVE = POSED_WAVE + 1;
const ARRIVING_ROCKS = waveRockCount(ARRIVING_WAVE);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("puts up ten Large rocks for wave 7", async () => {
  const cleared = await clearAWave(h, { wave: POSED_WAVE });
  const arrival = await arrivedWave(h, cleared);
  await captureStill(h, "wave");

  assertLength(
    arrival.rocks,
    ARRIVING_ROCKS,
    `rocks on the field on the tick the wave announced by clearing wave ` +
      `${POSED_WAVE} arrived, which specs/progression.md puts at ` +
      `WAVE_BASE_ROCKS + ${ARRIVING_WAVE} (${ARRIVING_ROCKS}); the game ` +
      `reported wave ${arrival.wave}`,
  );
  for (const rock of arrival.rocks) {
    assertEqual(
      rock.size,
      "large",
      `the size of ${describeRock(rock)}, one of wave ${ARRIVING_WAVE}'s ` +
        `rocks (specs/progression.md spawns Large rocks)`,
    );
  }
});
