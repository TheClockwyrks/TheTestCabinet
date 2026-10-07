// rendering/screen-shake-is-only-visual — the shake moves the picture and
// nothing else.
//
// specs/assets.md: the screen shake "is purely visual and never moves the
// simulation". A jitter folded into the world rather than into the drawing would
// slide the miner along the rock, shove it through a wall, or leave the cells it
// stands on somewhere other than where the game put them, and every rule the
// game is built on rests on those two being exactly where the simulation says.
//
// THE READING. A gas pocket is posed under the miner and cut through with the
// miner's own drill, so a real detonation arms whatever shake the build runs.
// The state is then read the frame the pocket goes off, and read again over the
// frames the shake plays out on: the miner's position and velocity must be the
// SAME NUMBERS, exactly, and every cell around the crater must still be the cell
// it was, at the health it was.
//
// WHY THE WINDOW OPENS AFTER THE BLAST. The detonation itself legitimately
// changes things — it clears the cells inside its radius and it costs hull — so
// what is compared is the state the blast LEFT against the state a few tenths of
// a second later, with nothing else running. The drill key is released before the
// window opens, so nothing is being cut inside it, and the miner's travel is held
// so no honest movement can be mistaken for the shake.
//
// The cells read are the ring outside the blast radius specs/hazards.md fixes,
// so what the blast itself cleared is never in the comparison. The hazard notice
// is marked already fired, so no card is armed while the window runs.
//
// The harness stands up no produced files: this reading is of the SIMULATION,
// which runs the same whether a sprite arrived or not, and the sprites cost
// frames a check about numbers has no use for.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  driveCut,
  fillBlock,
  openScene,
  pinMiner,
  rowInBand,
  standOn,
  type Harness,
  type TileRead,
} from "../harness";

/** The column the pocket is cut in. */
const BLAST_COL = 20;

/** How many cells either side of the pocket the field of rock runs. */
const FIELD_HALF = 3;

/** How far out the read ring sits: outside the blast radius, inside the field. */
const RING = 2;

/** How many samples the shake window is read over, and how many frames apart. */
const WINDOW_SAMPLES = 12;
const WINDOW_STEP = 6;

/** One cell as this check compares it: what it is, and how far through it is. */
interface CellState {
  col: number;
  row: number;
  kind: string;
  health: number | null;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the miner and the cells exactly where they were through the shake", async () => {
  openScene(h);
  // Travel held, the drill left running: the cut is what sets the blast off.
  pinMiner(h);
  h.debug.setNoticeFired("gas", true);

  const row = rowInBand("topsoil", h.snapshot().coreRow);
  fillBlock(
    h,
    {
      fromCol: BLAST_COL - FIELD_HALF,
      toCol: BLAST_COL + FIELD_HALF,
      fromRow: row - FIELD_HALF,
      toRow: row + FIELD_HALF,
    },
    "rock",
  );
  // The miner's own box stands in open air over the pocket.
  h.debug.setTile(BLAST_COL, row - 1, "tunnel");
  h.debug.setTile(BLAST_COL, row - 2, "tunnel");
  h.debug.setTile(BLAST_COL, row, "gas");
  standOn(h, BLAST_COL, row);
  await h.advance(2);

  /** The ring of cells outside the blast radius, as they stand. */
  const readRing = (): CellState[] => {
    const cells: CellState[] = [];
    for (let dRow = -RING; dRow <= RING; dRow += 1) {
      for (let dCol = -RING; dCol <= RING; dCol += 1) {
        if (Math.abs(dRow) < RING && Math.abs(dCol) < RING) continue;
        const col = BLAST_COL + dCol;
        const cellRow = row + dRow;
        const tile: TileRead = h.tileAt(col, cellRow);
        cells.push({
          col,
          row: cellRow,
          kind: tile.kind,
          health: tile.health,
        });
      }
    }
    return cells;
  };

  const shaken = await captureReplay(h, "still", async () => {
    const cut = await driveCut(h, "down", { col: BLAST_COL, row });
    const blast = h.snapshot().miner;
    const ringAfterBlast = readRing();

    const poses: { x: number; y: number; vx: number; vy: number }[] = [];
    for (let sample = 0; sample < WINDOW_SAMPLES; sample += 1) {
      await h.advance(WINDOW_STEP);
      const { miner } = h.snapshot();
      poses.push({ x: miner.x, y: miner.y, vx: miner.vx, vy: miner.vy });
    }
    return {
      cut,
      blast: { x: blast.x, y: blast.y, vx: blast.vx, vy: blast.vy },
      ringAfterBlast,
      poses,
      ringAfterShake: readRing(),
    };
  });

  assertEqual(
    shaken.cut.broke,
    true,
    "the posed gas pocket cut through, so the detonation the shake follows actually happened",
  );

  for (const [sample, pose] of shaken.poses.entries()) {
    assertDeepEqual(
      pose,
      shaken.blast,
      `the miner's position and velocity ${(sample + 1) * WINDOW_STEP} frames into the shake, unchanged from the frame the pocket went off`,
    );
  }

  assertDeepEqual(
    shaken.ringAfterShake,
    shaken.ringAfterBlast,
    `every cell in the ring ${RING} tiles out from the pocket, unchanged from the frame it went off`,
  );
});
