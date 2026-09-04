// presentation/hexes-visible-on-the-field — the field's ninety-one cells are
// drawn so one cell's extent is told from its neighbours'.
//
// THE RULE. "The field's hexes are visible enough to place parts by"
// (`specs/field.md`, Presentation). The field itself is "the hexagonal region of
// radius `FIELD_R` around `(0, 0)` ... That is `91` hexes", and the centre of hex
// `(q, r)` is fixed by `hexX`/`hexY` in the same file. `specs/assets.md` puts "The
// sky and the hex field's ninety-one cells" under "What stays drawn in code",
// fixed by `specs/field.md`, so no produced file is involved and what is read is
// what the build painted.
//
// HOW A CELL'S EXTENT IS READ, WITHOUT FIXING A LOOK. `specs/ui.md` "fixes no
// palette, no font, and no background", so nothing here may say what a cell is
// drawn AS — only that the boundary between two cells is drawn differently from
// the middle of a cell. Two adjacent centres are `HEX_PITCH` (`48`) apart and the
// edge they share is the perpendicular bisector of that segment, so the midpoint
// between the two centres lies exactly ON their shared edge. A build that outlines
// its cells, fills them in alternating tones, or draws them as separate plates all
// pass; a field painted as one flat wash does not.
//
// THE SAMPLE IS A RUN OF POINTS ACROSS THE EDGE, not a single one, because an
// outline may be a line one unit wide and a five-point cluster can straddle it
// without landing on it. Twenty-one points spanning the middle fifth of the
// segment cannot miss a line that crosses the segment at its midpoint.
//
// THE WORLD IS EMPTY. The challenge is opened in the editor with no machine and no
// run, so nothing is on the field but the field: no mote, no part, no ghost, and
// no selection can be what a sample found.
//
// THE VERDICT. Every one of the `91` cells has a neighbour whose shared edge is
// drawn apart from that cell's own centre, by more than `CHANNEL_EPSILON` — the
// case's own span for two pixels being the same colour.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { FIELD_R } from "../constants";
import { fieldHexes, hexCenter, neighbors, onField, type Hex } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  CHANNEL_EPSILON,
  colorDistance,
  createHarness,
  openChallengeDocument,
  rgbOf,
  sampleColor,
  type Harness,
  type Point,
} from "../harness";

/** The ninety-one cells `specs/field.md` counts at radius `FIELD_R` (`5`). */
const FIELD_CELLS = 91;

/** Points spanning the middle fifth of the segment joining two hex centres. */
function acrossTheEdge(from: Point, to: Point): Point[] {
  const points: Point[] = [];
  for (let step = 0; step <= 20; step += 1) {
    const t = 0.4 + (step / 20) * 0.2;
    points.push({
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
    });
  }
  return points;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws every one of the ninety-one cells with an edge told from its middle", async () => {
  await openChallengeDocument(h, BARE);
  await captureStill(h, "field");

  const cells: readonly Hex[] = fieldHexes();
  assertEqual(
    cells.length,
    FIELD_CELLS,
    `the field of radius FIELD_R (${FIELD_R}) is ${FIELD_CELLS} hexes, which is what this point reads every one of`,
  );

  for (const cell of cells) {
    const centre = hexCenter(cell);
    const middle = await sampleColor(h, centre.x, centre.y, 4);
    let apart = 0;
    for (const next of neighbors(cell)) {
      if (!onField(next)) continue;
      const samples = await h.pixels(acrossTheEdge(centre, hexCenter(next)));
      for (const sample of samples) {
        apart = Math.max(apart, colorDistance(middle, rgbOf(sample)));
      }
    }
    assertGreaterThan(
      apart,
      CHANNEL_EPSILON,
      `the boundary hex (${cell.q}, ${cell.r}) shares with a neighbour is drawn apart from that cell's own middle, so its extent is told from its neighbours' rather than the field being one flat wash`,
    );
  }
});
