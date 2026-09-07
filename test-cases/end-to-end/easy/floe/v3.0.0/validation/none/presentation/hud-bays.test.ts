// Floe — presentation/hud-bays: the fifth readout carries one mark per bay, and
// each mark answers for its own bay.
//
// `specs/ui.md`'s HUD table fixes the fifth readout: "Bays | One mark per bay, in
// the bays' own left-to-right order, each showing whether that bay is filled."
// Two of those three are read here, and both from presence alone: each bay HAS a
// mark (filling it changes the bar) and each bay's mark is its OWN (no pixel of
// the bar answers for two bays, so filling one leaves every other bay's alone).
// WHERE the marks stand is not read. `specs/ui.md` leaves the HUD's arrangement
// to the build, and where inside a region a mark landed is appearance, which the
// reviewer's `presentation` rating judges.
//
// WHY THIS IS NOT READ AS TEXT, OR AS A COLOUR. `specs/ui.md` calls it a mark and
// leaves the HUD's "arrangement and styling" to the build: a filled pip, a lit
// square, a critter icon and a tick are each exactly what was asked for, and none
// of them is text. So the readout is FOUND rather than assumed — the bar is read
// with every bay open, then again with exactly one bay filled, and what moved
// between the two IS that bay's mark. Nothing here names a colour, a shape, a
// size or a place in the bar, and nothing measures one either.
//
// EACH POSE IS ITS OWN FRESH CROSSING, READ AT THE SAME TICK. The six frames —
// the open baseline and one per bay — are posed identically by `startCrossing`
// and each is read one tick after its own `reset`, so the game time and the other
// four readouts are the same in all six and the filled bay is the only thing that
// differs. A difference in the bar therefore cannot be the clock, because the
// clock reads the same in all six — and it cannot be anything the game draws
// at random, because all of that is the strait's (the lanes' phases,
// `specs/ice.md` and `specs/water.md`; the bonus bay, `specs/bays.md`) and
// nothing drawn on the strait is drawn inside the HUD bar (`specs/ui.md`).
//
// ONLY THE HUD BAR IS READ, over `y` in `[0, HUD_H]` (`specs/strait.md`). Filling
// a bay changes the FAR SHORE as well — that is `bays`' business, not this
// readout's — and reading the bar alone keeps the strait's own drawing out of the
// reading entirely.
//
// AND POSING A BAY FILLED CLEARS NO LEVEL. `specs/bays.md` clears a level on the
// HOP that fills the last open bay, so four bays left open and one posed filled
// is a crossing still being played; `bays/posed-full-does-not-clear` is the item
// that grades that.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { BAY_COUNT, HUD_H, STAGE_W } from "../constants";
import {
  captureStill,
  createHarness,
  startCrossing,
  type Harness,
} from "../harness";
import { differingPixels, readRaster, type Raster } from "./raster";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** A fresh crossing with `filled` posed (or none), and the HUD bar it drew. */
async function barWith(filled: number | null): Promise<Raster> {
  await startCrossing(h);
  if (filled !== null) await h.debug.setBay(filled, true);
  await h.step(1);
  const bays = (await h.snapshot()).bays;
  assertDeepEqual(
    bays,
    Array.from({ length: BAY_COUNT }, (_, bay) => bay === filled),
    `the five bays as this frame posed them${
      filled === null ? ", all open" : `, with bay ${filled} filled alone`
    } (specs/instrumentation.md)`,
  );
  return readRaster(h, 0, 0, STAGE_W, HUD_H);
}

it("gives every bay its own mark in the HUD's bay readout", async () => {
  const open = await barWith(null);
  const moved: number[][] = [];
  for (let bay = 0; bay < BAY_COUNT; bay += 1) {
    const filled = await barWith(bay);
    // Any difference at all: the six frames are posed alike and read at the same
    // tick, so a pixel that is not byte-identical between two of them is a pixel
    // the posed bay moved.
    moved.push(differingPixels(open, filled, 0));
  }
  // Before the assertions, so a failing verdict still leaves the last bar.
  await captureStill(h, "hud");

  // One mark per bay: filling a bay draws something in the bar that an open bay
  // does not have there.
  for (let bay = 0; bay < BAY_COUNT; bay += 1) {
    assertGreaterThan(
      moved[bay].length,
      0,
      `the device pixels of the HUD bar that changed when bay ${bay} alone was ` +
        `posed filled — the bay readout carries one mark per bay, each showing ` +
        `whether that bay is filled (specs/ui.md)`,
    );
  }

  // Each mark is the bay's OWN: no pixel of the bar answers for two bays, so a
  // bay that stays open keeps its mark when another one fills.
  for (let a = 0; a < BAY_COUNT; a += 1) {
    const mine = new Set(moved[a]);
    for (let b = a + 1; b < BAY_COUNT; b += 1) {
      assertEqual(
        moved[b].filter((index) => mine.has(index)).length,
        0,
        `the device pixels of the HUD bar that changed for bay ${a} and for ` +
          `bay ${b} alike — each bay has its own mark, so filling one leaves ` +
          `every other bay's alone (specs/ui.md)`,
      );
    }
  }

  assertDeepEqual(h.pageErrors, []);
});
