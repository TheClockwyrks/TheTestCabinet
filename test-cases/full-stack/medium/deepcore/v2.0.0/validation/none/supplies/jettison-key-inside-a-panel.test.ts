// supplies/jettison-key-inside-a-panel — the jettison key works with a panel open.
//
// `specs/items.md`, Jettisoning the Core Sample: "The jettison control is the
// jettison key, which acts throughout the mine with a panel open exactly as with
// the mine clear, or the `JETTISON` control in the inventory." The inventory is
// where that control is drawn, so the overlay is exactly the state a player
// reaches for the key in.
//
// What is decided here is only that the key acts from inside a panel: the Sample
// leaves the satchel and lands on the miner's own cell as a ground item. What the
// timer does across the drop is `core-run/jettison-keeps-the-timer-running`, and
// that a jettisoned Sample cannot be picked back up is its own point.
//
// ISOLATION. An empty mine with the miner held still on an open tunnel cell, its
// drill held too, and nothing carried but the Sample.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  openScene,
  pinDrill,
  pinMiner,
  standOn,
  type Harness,
} from "../harness";

/** Where the miner stands: an open cell in an empty mine, well clear of the camp. */
const COL = 12;
const FLOOR_ROW = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("drops the carried Sample when the key is struck inside the inventory", async () => {
  await openScene(h);
  await h.debug.setTile(COL, FLOOR_ROW, "rock");
  await standOn(h, COL, FLOOR_ROW);
  await pinMiner(h);
  await pinDrill(h);
  await h.debug.setCoreCarried(true);
  await h.debug.setPanel("inventory");
  await h.advance(1);
  const carried = await h.snapshot();

  const dropped = await captureReplay(h, "drop", async () => {
    await h.tap(ACTION_KEY.jettison);
    const after = await h.snapshot();
    await h.advance(30);
    return after;
  });

  assertEqual(
    carried.satchel.coreSample,
    true,
    "the Sample was carried before the key was struck",
  );
  assertEqual(carried.panel, "inventory", "the overlay was open");
  assertEqual(
    dropped.panel,
    "inventory",
    "specs/items.md: jettisoning does not close the overlay it was struck from",
  );
  assertEqual(
    dropped.satchel.coreSample,
    false,
    "specs/items.md: jettisoning takes the Sample out of the satchel",
  );
  assertNotNull(
    dropped.coreGround,
    "specs/items.md: the Sample lands on its cell as a ground item",
  );
  assertEqual(
    dropped.coreGround?.col,
    carried.miner.col,
    "specs/items.md: it drops onto the miner's current cell",
  );
  assertEqual(
    dropped.coreGround?.row,
    carried.miner.row,
    "specs/items.md: it drops onto the miner's current cell",
  );
});
