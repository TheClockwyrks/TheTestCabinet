// movement/rests-on-solid — the miner box never overlaps a solid cell.
//
// `specs/character.md`: "Collision. The miner's box never overlaps a cell that is
// not a tunnel. It rests on top of solid cells and is stopped by walls." A build
// that lets the box sink into rock, or lets a fast enough fall pass straight
// through the floor, has no mine: the shaft the prospector digs is the only way
// down, and the rock either side of it is what makes it a shaft.
//
// THE READING IS TAKEN AFTER THE HARDEST LANDING THE GAME HAS. The drop is long
// enough for the fall to reach `FALL_TERMINAL_EMPTY`, so the miner arrives at the
// fastest an empty fall ever travels — `950` units per second, which is nearly
// twelve tiles of travel in a second and more than a tile in a single frame of a
// slow display. If a build resolves collision by looking at where the box IS
// rather than at the path it took, that is the speed it fails at.
//
// Three things are read: that the fall stopped rather than carrying on, that the
// box's underside is on the floor cell's top face and not below it, and that the
// floor cell is still there — a miner that passed through it would leave it
// standing while the miner reads as below it. Whether the landing costs hull
// belongs to the hazard checks; the drill is gated, so nothing was cut on the way.

import { afterEach, beforeEach, it } from "vitest";
import { FALL_TERMINAL_EMPTY, TILE } from "../constants";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureReplay,
  createHarness,
  digShaft,
  driveFall,
  minerFeet,
  openScene,
  pinDrill,
  type Harness,
} from "../harness";

const COL = 8;
/** The shaft's open rows, and the solid cell the fall lands on. */
const TOP_ROW = 4;
const FLOOR_ROW = 40;

/** Far enough that the fall is at terminal speed when it arrives. */
const HEIGHT = 30 * TILE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("stops a terminal-speed fall on top of the cell rather than inside it", async () => {
  openScene(h);
  digShaft(h, COL, TOP_ROW, FLOOR_ROW - 1);
  pinDrill(h);

  const fall = await captureReplay(h, "landing", () =>
    driveFall(h, COL, FLOOR_ROW, HEIGHT, { maxFrames: 600 }),
  );

  assertEqual(fall.landed, true, "the miner came to rest on the floor");
  // It really was travelling: a landing at a crawl would prove nothing.
  assertGreaterThan(
    fall.impactSpeed,
    FALL_TERMINAL_EMPTY * 0.9,
    "the speed the fall arrived at",
  );

  const { miner } = fall.snapshot;
  assertEqual(miner.vy, 0, "the downward speed after the landing");
  assertLessThanOrEqual(
    minerFeet(miner),
    FLOOR_ROW * TILE,
    "the miner's underside against the floor cell's top face",
  );
  assertGreaterThanOrEqual(
    minerFeet(miner),
    FLOOR_ROW * TILE - 1,
    "the miner's underside against the floor cell's top face",
  );

  // The floor is still floor: nothing was drilled and nothing was passed through.
  assertEqual(
    h.tileAt(COL, FLOOR_ROW).kind,
    "rock",
    "the cell the miner landed on",
  );
});
