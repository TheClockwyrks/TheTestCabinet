// rendering/tunnel-is-inset — a carved cell is drawn narrower than the cell it
// was carved out of.
//
// specs/assets.md: "A carved cell is drawn inset with a lip of the band's dirt
// and rounded corners, so a tunnel is narrower than a full cell." The passage a
// player digs therefore reads as a hole worked out of the rock rather than as a
// grid square swapped for another grid square, and the cell's border pixels
// carry the band's dirt rather than the tunnel's fill.
//
// THE READING. One cell is opened inside a solid field of the rockbed's rock, so
// every one of its four sides has solid rock behind it and the lip must run all
// the way round. Two colours are then read from the same frame: the FILL, at the
// centre of the opened cell, and the DIRT, at the centre of a solid cell two
// columns away. Each of the four border points is read against those two, and a
// border point is a lip when it sits nearer the dirt than the fill.
//
// HOW CLOSE TO THE EDGE. The specification fixes no lip width, so the border is
// read two units inside the cell's own edge — the closest a check can stand to
// the boundary and still be inside the cell at all. Any lip a player could see
// covers it. Each border point is averaged over three samples five units apart
// ALONG the edge, so the fine grain specs/assets.md asks of the rock cannot swing
// one reading.
//
// THE GUARD. The reading is a comparison against the tunnel fill, so it says
// nothing unless the build's dirt and its fill are themselves apart:
// specs/overview.md requires that "an unmined tile is clearly distinct from a
// carved tunnel", and a build that draws the two alike has no border pixels that
// could be told from its fill.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { TILE } from "../constants";
import {
  DISTINCT_MIN,
  captureStill,
  colorDistance,
  createHarness,
  sampleCell,
  type Harness,
} from "../harness";
import { layRockField } from "./field";
import { meanAt, readsAs, stageOf } from "./sample";

/** How far inside the cell's own edge a border point is read, in units. */
const BORDER_INSET = 2;

/** How far apart the three samples of one border point sit, along the edge. */
const ALONG_EDGE = 5;

/** How many columns away the plain dirt is read from. */
const DIRT_OFFSET = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a lip of dirt around every side of a carved cell", async () => {
  const field = await layRockField(h);
  const col = field.fromCol + 2;
  const { row } = field;
  await h.debug.setTile(col, row, "tunnel");

  await h.advance(1);
  const snapshot = await h.snapshot();
  const fill = await sampleCell(h, snapshot, col, row);
  const dirt = await sampleCell(h, snapshot, col + DIRT_OFFSET, row);

  const left = col * TILE;
  const top = row * TILE;
  const mid = TILE / 2;
  const borders = {
    top: {
      at: stageOf(snapshot, left + mid, top + BORDER_INSET),
      along: "x" as const,
    },
    bottom: {
      at: stageOf(snapshot, left + mid, top + TILE - BORDER_INSET),
      along: "x" as const,
    },
    left: {
      at: stageOf(snapshot, left + BORDER_INSET, top + mid),
      along: "y" as const,
    },
    right: {
      at: stageOf(snapshot, left + TILE - BORDER_INSET, top + mid),
      along: "y" as const,
    },
  };

  const read = new Map<string, "dirt" | "fill">();
  for (const [side, border] of Object.entries(borders)) {
    const points =
      border.along === "x"
        ? [
            border.at,
            { x: border.at.x - ALONG_EDGE, y: border.at.y },
            { x: border.at.x + ALONG_EDGE, y: border.at.y },
          ]
        : [
            border.at,
            { x: border.at.x, y: border.at.y - ALONG_EDGE },
            { x: border.at.x, y: border.at.y + ALONG_EDGE },
          ];
    read.set(side, readsAs(await meanAt(h, points), dirt, fill));
  }
  await captureStill(h, "inset");

  // The reading only says something where the two ends of it are apart.
  assertGreaterThan(
    colorDistance(dirt, fill),
    DISTINCT_MIN,
    "the band's unmined rock drawn clearly apart from the carved tunnel's fill, in RGB distance",
  );

  for (const side of ["top", "bottom", "left", "right"]) {
    assertEqual(
      read.get(side),
      "dirt",
      `the carved cell's ${side} border, read ${BORDER_INSET} units inside the cell edge, carrying the band's dirt rather than the tunnel fill`,
    );
  }
});
