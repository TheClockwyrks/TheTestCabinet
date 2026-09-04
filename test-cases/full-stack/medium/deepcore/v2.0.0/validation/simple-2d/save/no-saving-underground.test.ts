// save/no-saving-underground — nothing but the Save Pad ever writes a save.
//
// specs/gameplay.md: "The Save Pad is the only way to save. There is no autosave
// and no saving underground." So an expedition that never visits the pad has no
// save, however much it did: selling a cargo, buying fuel, repair, an upgrade and
// a supply, sinking a shaft and cutting into the rock at the bottom of it, half a
// minute of game time, and finally a death all leave `hasSave` false.
//
// THE SLOT IS REAL. The harness installs a working `localStorage` before the game
// initializes, so an autosave HAS somewhere to go; a check run on the storage-less
// default would read `false` from the host rather than from the build.
//
// WHAT IS DELIBERATELY NOT CALLED. `save()`, the control that stands for
// activating the pad, is the one operation this check must never touch: it is the
// thing whose absence is being read. Everything below is either a control a
// player reaches from a panel, or the game's own simulation running.
//
// ISOLATION. One generated expedition with the slot cleared at the start, so the
// reading is this expedition's and not a leftover, and no Core Sample, notice or
// ground item anywhere near it.

import { afterEach, beforeEach, it } from "vitest";
import { TILE } from "../../src/constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  digShaft,
  driveCut,
  driveFall,
  stageCargo,
  type Harness,
} from "../harness";
import { driveDeath, openGeneratedAtCamp } from "./expedition";

/** The shaft the descent runs down, and the cell the drill bites at its foot. */
const DIG_COL = 10;
const SHAFT_TOP = 2;
const SHAFT_BOTTOM = 20;
const FLOOR_ROW = SHAFT_BOTTOM + 1;

/** How high above the floor the drop starts, in world units. */
const DROP_HEIGHT = 8 * TILE;

/** Credits posed so every purchase below is affordable rather than refused. */
const BUDGET = 6000;

/** The stretch of game time that passes with nothing happening. */
const IDLE_SECONDS = 30;
const IDLE_FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ storage: true });
});

afterEach(() => {
  h?.dispose();
});

it("writes no save for selling, buying, digging, waiting or dying", async () => {
  await openGeneratedAtCamp(h);
  assertEqual(
    h.snapshot().hasSave,
    false,
    "the slot was cleared before the expedition began",
  );

  // The surface loop, through the controls that stand for the panels'.
  stageCargo(h, { ferron: 3 });
  h.debug.sell();
  const sold = h.snapshot();
  assertGreaterThan(
    sold.credits,
    0,
    "specs/mining.md: selling the cargo earns Credits",
  );
  assertEqual(sold.hasSave, false, "specs/gameplay.md: selling writes no save");

  h.debug.setCredits(BUDGET);
  h.debug.setFuel(10);
  h.debug.buyFuel();
  h.debug.setHull(50);
  h.debug.buyRepair();
  h.debug.buyUpgrade("drill");
  h.debug.buyItem("dynamite");
  assertEqual(
    h.snapshot().hasSave,
    false,
    "specs/gameplay.md: buying fuel, repair, an upgrade or a supply writes no save",
  );

  // The descent: a real fall down a real shaft and a real cut at the foot of it.
  digShaft(h, DIG_COL, SHAFT_TOP, SHAFT_BOTTOM);
  const dug = await captureReplay(h, "none", async () => {
    const fall = await driveFall(h, DIG_COL, FLOOR_ROW, DROP_HEIGHT);
    const cut = await driveCut(h, "down", { col: DIG_COL, row: FLOOR_ROW });
    await h.advanceSeconds(IDLE_SECONDS, IDLE_FRAMES);
    return { fall, cut, snapshot: h.snapshot() };
  });
  assertEqual(dug.fall.landed, true, "the drop reached the floor of the shaft");
  assertEqual(
    dug.cut.broke,
    true,
    "the drill cut through the floor of the shaft",
  );
  assertGreaterThan(
    dug.snapshot.deepestDepthMeters,
    0,
    "specs/gameplay.md: the expedition really did go underground",
  );
  assertEqual(
    dug.snapshot.hasSave,
    false,
    `specs/gameplay.md: descending, drilling and ${IDLE_SECONDS}s of play write no save`,
  );

  const over = await driveDeath(h, "hull-destroyed");
  assertEqual(
    over.hasSave,
    false,
    "specs/gameplay.md: dying writes no save either",
  );
});
