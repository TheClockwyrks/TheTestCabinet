// rendering/ore-is-distinguishable — an ore cell is drawn as a vein rather than
// as plain rock.
//
// specs/overview.md: "An ore vein stands out from the plain rock of its band."
// specs/assets.md draws it as "a smear of mineral run through the dirt: a streak
// spreading across much of the cell, feathering into the rock at the edges so the
// band rock shows through". The specification fixes no palette, so what a check
// reads is that the vein is DRAWN: the cell's picture changes when an ore is
// what is in it. How much it stands out is the presentation rating's, not this
// check's.
//
// AND ONLY THAT IT IS DRAWN. The rest of that sentence — "reaching the cell's
// edges so adjacent ore cells read as one continuous vein. An ore is never a
// discrete nugget sitting on the rock" — is about the SHAPE of the smear, and
// this case reads that shape off the still rather than off the pixels:
// `assets/ore-overlays` says so of the same thirteen drawings, "whether the
// smears read as smears and the jewels as jewels is a reviewer's reading off the
// still". So a vein drawn as a nugget is answered there and by the presentation
// rating, and no build is failed HERE for a shape this point does not judge.
//
// THE CELL, NOT ITS MIDDLE. A smear that feathers into the rock covers some of
// the cell and leaves the rest showing through, and nothing in the specification
// says the middle is one of the places it covers — a streak laid across a corner
// is exactly what that sentence describes. So the reading is `sampleCellInterior`
// over the whole cell and the point the two pictures are furthest apart, rather
// than one patch at the centre, which a conforming build can leave bare.
//
// AGAINST THE BUILD'S OWN DRIFT. Nothing fixes a rock cell as drawn the same way
// twice. One of the builds this was written against re-draws most of a rock cell,
// by up to twenty units of colour, every time that cell is WRITTEN — written even
// to the kind it already held — while leaving it perfectly still from frame to
// frame with nothing posed at all. A reading that asked only whether the picture
// moved would pass such a build whatever it drew over the ore. So the cell is
// first read TWICE AS ROCK, across the same gap and across a write of the same
// cell, which is how the vein is posed too, and what that drift reaches is the
// floor the vein has to clear. The floor is measured off the build in front of
// the check rather than named here: a build that draws one cell one way is held
// to any change at all, and one that stamps a fresh grain on every write to more
// than its own stamping.
//
// The vein's reading and the floor are each the GREATEST that quantity reaches
// anywhere in the cell, rather than a margin taken point by point. That is the
// stricter of the two: a margin taken point by point only needs ONE place where
// the vein happened to beat the stir, and a cell whose rock is stirring all over
// has such places whatever is drawn on it. Neither reading is the whole of what
// rejects a build that draws no vein — the reading below, which the vein has to
// part from the rock on both sides of, rejects such a build wherever its stir
// does not happen to fall the same way twice.
//
// THE READING is one cell, four times, for each ore: rock, rock, the vein, rock.
// Same cell, same camera, same neighbours, so the only difference between one
// reading and the next is the kind of the cell. The vein has to part from the
// rock before it AND from the rock after it at one and the same point of the
// grid, so a single stirred frame cannot stand in for a drawn smear.
//
// EVERY ORE, IN ITS OWN BAND. The requirement is about ore against rock rather
// than about one chosen ore, so each of the thirteen the specification names is
// posed in turn, and each is posed at the depth its own draw curve peaks at
// (specs/mining.md), which is the band a player actually meets it in.
//
// The miner is parked clear of the vein with both faculties held, so nothing is
// banked and nothing is cut while the frames are read.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  ORES,
  ORE_IDS,
  ORE_MIN_ROW,
  rowAtFraction,
  type Ore,
} from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  fillBlock,
  minerXOn,
  minerYOn,
  openScene,
  pinDrill,
  pinMiner,
  placeAt,
  sampleCellInterior,
  type Harness,
} from "../harness";

/** The column the vein sits in, mid-mine so the camera holds it. */
const ORE_COL = 16;

/** How many columns of plain band rock are laid either side of the posed cell. */
const ROCK_MARGIN = 2;

/** How far to the side the miner waits, clear of the vein. */
const MINER_OFFSET = 4;

/**
 * Frames between one reading and the next.
 *
 * The SAME gap for all four, so the drift the two rock readings measure is the
 * drift the vein is read across.
 */
const SETTLE = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws every ore vein differently from the rock the same cell holds", async () => {
  await openScene(h);
  await pinMiner(h);
  await pinDrill(h);
  const { coreRow } = await h.snapshot();

  const apart = new Map<Ore, number>();
  const drift = new Map<Ore, number>();
  for (const [index, ore] of ORE_IDS.entries()) {
    const row = Math.max(
      ORE_MIN_ROW + 1,
      rowAtFraction(ORES[ore].peak, coreRow),
    );
    await fillBlock(
      h,
      {
        fromCol: ORE_COL - ROCK_MARGIN,
        toCol: ORE_COL + ROCK_MARGIN,
        fromRow: row - 1,
        toRow: row + 1,
      },
      "rock",
    );
    await placeAt(h, minerXOn(ORE_COL - MINER_OFFSET), minerYOn(row));

    // The cell as plain rock, twice, for what the build's own drawing does to it
    // over one gap with nothing changed ...
    await h.debug.setTile(ORE_COL, row, "rock");
    await h.advance(SETTLE);
    const before = await sampleCellInterior(
      h,
      await h.snapshot(),
      ORE_COL,
      row,
    );
    await h.debug.setTile(ORE_COL, row, "rock");
    await h.advance(SETTLE);
    const idle = await sampleCellInterior(h, await h.snapshot(), ORE_COL, row);

    // ... the same cell holding the vein ...
    await h.debug.setOreTile(ORE_COL, row, ore);
    await h.advance(SETTLE);
    const vein = await sampleCellInterior(h, await h.snapshot(), ORE_COL, row);
    if (index === 0) await captureStill(h, "vein");

    // ... and back to plain rock.
    await h.debug.setTile(ORE_COL, row, "rock");
    await h.advance(SETTLE);
    const after = await sampleCellInterior(h, await h.snapshot(), ORE_COL, row);

    let moved = 0;
    let stirred = 0;
    for (let at = 0; at < idle.length; at += 1) {
      stirred = Math.max(stirred, colorDistance(before[at], idle[at]));
      moved = Math.max(
        moved,
        Math.min(
          colorDistance(idle[at], vein[at]),
          colorDistance(vein[at], after[at]),
        ),
      );
    }
    apart.set(ore, moved);
    drift.set(ore, stirred);
  }

  for (const ore of ORE_IDS) {
    assertGreaterThan(
      apart.get(ore) as number,
      drift.get(ore) as number,
      `the cell's interior with a ${ore} vein in it against the same cell with plain rock in it, past what the build stirs that rock by on its own`,
    );
  }
});
