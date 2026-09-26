// Deepcore — supplies/explosives-cost-no-fuel: a charge is instant and free.
//
// `specs/items.md`: "The clear is instant and costs no fuel." Both halves are one
// requirement about what a charge spends, and both are read across the call
// itself: the tank is sampled immediately before and immediately after
// `useItem`, with no frame in between, and the block is read as already open on
// that same reading.
//
// Reading either side of the call rather than either side of a frame is what
// makes this exact. `specs/character.md` drains `LIFE_SUPPORT_BURN` from a miner
// below the ground line every second it is down there, so a frame run between the
// two samples would take fuel that the charge did not — and the requirement is
// that the charge takes none.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DYNAMITE_RADIUS } from "../constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import {
  AFTERMATH_FRAMES,
  blockCells,
  openBlastScene,
  readCells,
} from "./blast-scene";

/** A tank part full, so a drain in either direction would be visible. */
const POSED_FUEL = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("spends no fuel on a charge and clears the block in the same instant", async () => {
  const centre = openBlastScene(h);
  h.debug.setFuel(POSED_FUEL);
  h.debug.setItemCount("dynamite", 1);

  const cells = blockCells(centre, DYNAMITE_RADIUS);

  const free = await captureReplay(h, "free", async () => {
    const before = h.snapshot();
    h.debug.useItem("dynamite");
    const after = h.snapshot();
    const cleared = readCells(h, cells);
    await h.advance(AFTERMATH_FRAMES);
    return { before, after, cleared };
  });

  assertEqual(free.before.miner.fuel, POSED_FUEL, "the tank before the charge");
  assertEqual(
    free.after.miner.fuel,
    POSED_FUEL,
    "the tank across the charge, with no frame run between the readings",
  );

  for (const [i, tile] of free.cleared.entries()) {
    assertEqual(
      tile.kind,
      "tunnel",
      `cell (${cells[i].col}, ${cells[i].row}) on the reading the charge was used on`,
    );
  }
});
