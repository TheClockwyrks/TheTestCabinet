// waves/wave-one-spawns-four — the wave a new game opens on puts up four Large
// rocks.
//
// `specs/progression.md`, Waves: "Wave `N` spawns `WAVE_BASE_ROCKS + N` (`3 + N`)
// Large rocks, so wave 1 puts up four and wave 2 puts up five." And, A new game:
// a new game "begins on a field cleared of everything the previous game left" at
// wave 1.
//
// NOTHING HERE IS POSED, BECAUSE NOTHING HERE CAN BE. `specs/instrumentation.md`
// has `setWave` spawn no rocks and clear none, so there is no operation that
// produces an opening wave — the game has to be opened the way a player opens it,
// from a reset title by confirming `PLAY`. That also leaves both world gates ON,
// since `reset` restores them, which is exactly what this item needs: the rocks it
// reads are the ones the build's own spawner put up.
//
// AND IT IS READ WHEN IT ARRIVES, NOT AT A FIXED MOMENT. `specs/progression.md`
// allows either opening for wave 1 — "put the rocks up at once when the game
// begins, or run the `WAVE 1` banner first and spawn as it ends" — so this sweeps
// every tick until the field holds a rock and reads it there. A build that spawns
// at once is read on its first tick and a build that runs the banner is read a
// second and a half later, and neither is preferred: the ceiling only bounds a
// build that never spawns at all.
//
// WHY THE FIRST TICK ANY ROCK EXISTS. Because the count is the whole point. A
// reading taken some fixed time after the arrival would let a build spawn one rock
// and trickle in three more; read on the tick the roster stops being empty, a wave
// that arrives in pieces reads as a wave of the wrong size, which is what it is.
//
// THE SIZES ARE READ TOO. The specification spawns Large rocks and nothing else,
// so a build that opens with four Mediums has put up a wave of the right size made
// of the wrong thing, and the count alone would pass it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { waveRockCount } from "../constants";
import {
  captureStill,
  createHarness,
  startGameFromTitle,
  type Harness,
} from "../harness";
import { ARRIVAL_TICKS, describeRock } from "./scenario";

/** The wave a new game opens on, and the rocks `specs/progression.md` gives it. */
const OPENING_WAVE = 1;
const OPENING_ROCKS = waveRockCount(OPENING_WAVE);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("opens a new game with four Large rocks", async () => {
  await startGameFromTitle(h);

  const arrival = await h.skipUntil((snapshot) => snapshot.rocks.length > 0, {
    maxTicks: ARRIVAL_TICKS,
    poll: 1,
  });
  await captureStill(h, "wave");

  assertLength(
    arrival.snapshot.rocks,
    OPENING_ROCKS,
    `rocks on the field on the tick wave ${OPENING_WAVE} arrived, which ` +
      `specs/progression.md puts at WAVE_BASE_ROCKS + ${OPENING_WAVE} ` +
      `(${OPENING_ROCKS}); the sweep ran ${arrival.ticks} of ${ARRIVAL_TICKS} ` +
      `ticks and the game reported wave ${arrival.snapshot.wave}`,
  );
  for (const rock of arrival.snapshot.rocks) {
    assertEqual(
      rock.size,
      "large",
      `the size of ${describeRock(rock)}, one of wave ${OPENING_WAVE}'s ` +
        `opening rocks (specs/progression.md spawns Large rocks)`,
    );
  }
});
