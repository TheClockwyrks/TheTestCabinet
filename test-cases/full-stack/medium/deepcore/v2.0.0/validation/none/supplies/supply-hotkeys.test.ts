// Deepcore — supplies/supply-hotkeys: each number key uses the supply of that
// number.
//
// `specs/controls.md` binds `supply1` through `supply6` to `Digit1` through
// `Digit6` and says each "Use[s] the field supply of that number";
// `specs/items.md` lists the six in that order, so `1` is Dynamite and `6` is
// Emergency Fuel. Six keys are six bindings, and this check decides the mapping:
// each key must take one from its own pocket and none from the other five.
//
// The keys go down through the surface's own input, which
// `specs/instrumentation.md` requires to flow "through the same handling the real
// keyboard feeds", so what is exercised is the binding the build registered.
//
// The scene is re-posed before every key, because each supply changes the world
// it is used in: a charge opens the rock, a teleporter moves the miner, and a
// supply "that would change nothing" is a no-op the specification does not
// consume. So each key is pressed into the same arrangement — the miner in a
// pocket of solid rock, underground, with a hull and a tank part spent — where
// every one of the six has real work to do.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ITEM_IDS } from "../constants";
import {
  captureReplay,
  createHarness,
  openScene,
  pinDrill,
  pinMiner,
  stageItems,
  standOn,
  type Harness,
} from "../harness";
import { BLAST_COL, layRockAround, SHALLOW_ROW } from "./blast-scene";

/** More than one of each, so a count taken to zero cannot be mistaken for the rule. */
const HELD = 2;

/** Frames each press is left on screen for, so the recording shows it. */
const SHOWN_FRAMES = 24;

/** A hull and a tank part spent, so the two topping supplies have work to do. */
const POSED_HULL = 40;
const POSED_FUEL = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("uses the supply of that number on each of Digit1 through Digit6", async () => {
  await openScene(h);
  await pinDrill(h);

  const held = await captureReplay(h, "keys", async () => {
    const readings: Record<string, number>[] = [];
    for (let index = 0; index < ITEM_IDS.length; index += 1) {
      // Back to the same arrangement for every key.
      await h.debug.setMinerTravel(true);
      await layRockAround(h, { col: BLAST_COL, row: SHALLOW_ROW });
      await standOn(h, BLAST_COL, SHALLOW_ROW + 1);
      await pinMiner(h);
      await h.debug.setHull(POSED_HULL);
      await h.debug.setFuel(POSED_FUEL);
      await stageItems(h, Object.fromEntries(ITEM_IDS.map((id) => [id, HELD])));

      await h.tap(`Digit${index + 1}`);
      readings.push({ ...(await h.snapshot()).items });
      // The counts are already read; these frames are for the recording, so each
      // press is a moment a reviewer can see rather than a single frame.
      await h.advance(SHOWN_FRAMES);
    }
    return readings;
  });

  for (const [index, id] of ITEM_IDS.entries()) {
    for (const other of ITEM_IDS) {
      assertEqual(
        held[index][other],
        other === id ? HELD - 1 : HELD,
        `${other} held after pressing Digit${index + 1}`,
      );
    }
  }
});
