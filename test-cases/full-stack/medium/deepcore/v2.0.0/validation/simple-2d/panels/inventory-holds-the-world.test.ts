// panels/inventory-holds-the-world — the mine stops behind the overlay.
//
// `specs/mining.md`: the world holds still behind the inventory overlay, but a
// live Core Sample's timer keeps running. `specs/hazards.md` states the second
// half from the other side: the timer never pauses while the expedition runs, at
// the surface, inside a panel, or in the inventory.
//
// Both halves are read off one span. The miner is posed falling through open air
// well below the ground line, so with the overlay shut two things would move: its
// position, under `GRAVITY`, and its fuel, under `LIFE_SUPPORT_BURN`. With the
// overlay open neither may, and the Sample's timer must fall by the whole span.
// The panel is posed through the surface rather than opened with the key, because
// the requirement is what the overlay HOLDS rather than what opens it.

import { afterEach, beforeEach, it } from "vitest";
import { CORE_TIMER, PLAYABLE_COL_MIN, TILE } from "../../src/constants";
import { assertBetween, assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  minerXOn,
  openScene,
  pinDrill,
  placeAt,
  type Harness,
} from "../harness";

/** The span the overlay is held open for, in seconds. */
const HELD_SECONDS = 3;

/** Frames that span is run in. Every rate is integrated against the delta. */
const HELD_FRAMES = 90;

/** A row deep enough that life support is burning and a fall has room. */
const ROW = 120;

const COL = PLAYABLE_COL_MIN + 5;

/** How far the timer may sit from the span, in seconds. */
const TIMER_TOLERANCE = 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the miner and its fuel while the Sample's timer runs on", async () => {
  openScene(h);
  pinDrill(h);
  placeAt(h, minerXOn(COL), ROW * TILE);
  h.debug.setMinerVelocity(0, 400);
  h.debug.setCoreCarried(true);
  h.debug.setPanel("inventory");

  const before = h.snapshot();
  const after = await captureReplay(h, "held", async () => {
    await h.advanceSeconds(HELD_SECONDS, HELD_FRAMES);
    return h.snapshot();
  });

  assertEqual(before.panel, "inventory", "specs/ui.md");
  assertEqual(after.miner.x, before.miner.x, "specs/mining.md");
  assertEqual(after.miner.y, before.miner.y, "specs/mining.md");
  assertEqual(after.miner.fuel, before.miner.fuel, "specs/mining.md");
  assertBetween(
    after.coreTimer ?? 0,
    CORE_TIMER - HELD_SECONDS - TIMER_TOLERANCE,
    CORE_TIMER - HELD_SECONDS + TIMER_TOLERANCE,
    "specs/hazards.md",
  );
});
