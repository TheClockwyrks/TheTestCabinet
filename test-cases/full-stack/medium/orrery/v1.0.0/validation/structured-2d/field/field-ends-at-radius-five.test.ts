// field/field-ends-at-radius-five — no cell is drawn outside the field's radius.
//
// THE RULE. "The field is the hexagonal region of radius `FIELD_R` around
// `(0, 0)`: hex `(q, r)` is on the field exactly when
// `max(|q|, |r|, |q + r|) <= FIELD_R`. That is `91` hexes"
// (`specs/field.md`, Hexes and axial coordinates). "Exactly when" is the whole of
// the point, and `specs/assets.md` puts "The sky and the hex field's NINETY-ONE
// CELLS" under "What stays drawn in code": the ninety-one are drawn — "the field's
// hexes are visible enough to place parts by" (`specs/field.md`, Presentation) —
// and there is no ninety-second cell to draw.
//
// WHAT IS READ, AND WHY IT IS THE FRAME'S OPERATIONS RATHER THAN ITS PIXELS. Both
// `specs/ui.md` and `specs/assets.md` leave the sky to the build — `specs/ui.md`
// fixes "no palette, no font, and no background", and the sky is drawn in code
// beside the cells — so a build may lay a wash under the field, shade it outward,
// or scatter stars over it, and the colour a point of the stage carries says
// nothing on its own about whether a CELL was drawn there. A cell has a shape,
// though, and that is what is read: the points the frame's drawing named, each
// mapped through the transform in force at it (`drawing.ts`).
//
// WHAT COUNTS AS A CELL. `specs/field.md` asks only that the field's hexes be
// "visible enough to place parts by", so a build is free to draw a cell as a
// shape round its hex or as a mark on its middle, and both readings are taken:
//
//   TRACED — the frame names a point in each of the SIX DIRECTIONS a pointy-top
//   hex's corners lie in. A cell that fills its hex runs its outline round the
//   centre whatever radius it is traced at and whether it is filled, stroked, or
//   both, so the six sectors of `60` degrees about the centre each carry at least
//   one point named within a cell's own extent — out to `CELL_R + CORNER_SLACK`,
//   a little past the circumradius `HEX_PITCH / sqrt(3)` (`27.71`).
//
//   CENTRED — the frame names a point within `CENTRE_CLEAR` of the hex's centre.
//   A dot, a disc, or a glyph on the middle of the hex is drawn from there, and
//   `drawnPoints` names an `arc` or an `ellipse` by its centre.
//
// The sectors are counted from `CENTRE_CLEAR` out, so a centre mark is read as
// the one thing it is rather than as six corners. These are the same two readings
// `presentation/wheel-spokes-reach-its-ring` says a build may draw a cell as, so
// the two points hold one view of what drawing a cell is. Nothing is required of
// the colour, the width, the inset, or the order.
//
// A CELL NEXT DOOR CANNOT BE MISTAKEN FOR ONE HERE. Adjacent cells share an edge
// and so share its two corners, which lie in two of this hex's six sectors. A
// ring-`6` hex has at most three neighbours on the field, and three consecutive
// neighbours share four of its six corners — so the sectors facing away from the
// field stay empty unless a cell was drawn on the hex itself. A neighbour's centre
// mark is a pitch away, `48` units, and no nearer this hex's centre than `20` past
// `CENTRE_CLEAR`.
//
// AND THE FIELD WAS REALLY DRAWN. A build that drew no cells at all would pass a
// check that only asks for their absence, so the reading is taken the other way
// round on the ring-`5` hexes bordering the ones read: each of them carries a
// cell, traced or centred. The pair is one statement — the field is drawn out to
// radius `FIELD_R` and stops there.
//
// A CENTRE MARK IS READ BEYOND THE FIELD AS A RING RATHER THAN AS A HEX, which is
// what keeps a stray point from standing in for a cell. A mark on the middle is
// one named point and a scattered star is one named point too, and `specs/ui.md`
// fixes "no background", so a build may "scatter stars over the sky" — the same
// freedom `presentation/wheel-spokes-reach-its-ring` names — and one of them may
// fall within `CENTRE_CLEAR` of any centre on the stage. What tells the two apart
// is that a build draws its cells the one way: it marks the middle of EVERY cell,
// so a ninety-second ring drawn that way carries a mark on every hex of the ring
// while a sky carries them where the stars happened to fall. So the centre reading
// is asked of the ring rather than of a hex, and only of a build that draws its
// own cells that way — which is a build every ring-`5` cell read carries a mark
// on. The traced reading is asked of each ring-`6` hex on its own, since a cell
// traced round a hex is a cell there whatever its neighbours carry.
//
// WHERE IT IS ASKED. Ring `6` — `max(|q|, |r|, |q + r|)` exactly `6` — is the
// first ring the rule excludes. Only the hexes whose whole cell extent lies inside
// the field's region are read, `specs/editor.md`'s "`x` `TRAY_REGION_W` (`224`) to
// `READOUT_X0` (`1008`), `y` `HEADING_H` (`48`) to `TAPE_Y0` (`560`)": outside it
// a build is drawing the tray, the readout, the heading or the tape panel, and
// what is there says nothing about the field.
//
// THE WORLD IS POSED, NOT SEARCHED. The challenge is loaded into the editor with
// an empty machine and no run at all, so there is no part, no mote and no fixture
// anywhere on the field — nothing but the field itself to draw.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertLessThan,
  assertNotEqual,
} from "../assert";
import { FIELD_R, HEX_PITCH } from "../constants";
import {
  at,
  contains,
  FIELD_REGION,
  hexCenter,
  type Hex,
  type StagePoint,
} from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  distanceBetween,
  openChallengeDocument,
  pointsNear,
  type DrawCall,
  type Harness,
} from "../harness";

let h: Harness;

/** The circumradius a cell that fills its hex is traced at. */
const CELL_R = HEX_PITCH / Math.sqrt(3);

/** How far past that radius a traced corner still counts as this cell's. */
const CORNER_SLACK = 4;

/** How near the centre a named point is the hex's middle rather than a corner. */
const CENTRE_CLEAR = 4;

/** The six directions a pointy-top hex's corners lie in, in radians. */
const CORNERS: number[] = Array.from(
  { length: 6 },
  (_unused, i) => ((60 * i - 90) * Math.PI) / 180,
);

/** The six corners of a hex, at the radius a filling cell is traced at. */
function cornersOf(hex: Hex): StagePoint[] {
  const centre = hexCenter(hex);
  return CORNERS.map((angle) => ({
    x: centre.x + CELL_R * Math.cos(angle),
    y: centre.y + CELL_R * Math.sin(angle),
  }));
}

/** Whether a hex's whole cell extent lies inside the field's region. */
function cellInsideRegion(hex: Hex): boolean {
  return cornersOf(hex).every((corner) => contains(FIELD_REGION, corner));
}

/** Which of the six corner sectors a point about a hex's centre lies in. */
function sectorOf(centre: StagePoint, point: StagePoint): number {
  const angle = Math.atan2(point.y - centre.y, point.x - centre.x);
  // Sector `i` is the 60 degrees centred on corner direction `i`, so the six of
  // them tile the circle and every point falls in exactly one.
  const turned = angle - (CORNERS[0] as number) + Math.PI / 6;
  const sixths = Math.floor((((turned / (Math.PI / 3)) % 6) + 6) % 6);
  return sixths;
}

/** How a cell is drawn on a hex, or `"none"` when none is. */
type CellReading = "traced" | "centred" | "none";

/** How the frame's drawing stands about one hex's centre. */
interface Marks {
  /** A point named in each of the six corner sectors. */
  traced: boolean;
  /** A point named within `CENTRE_CLEAR` of the centre. */
  centred: boolean;
}

/** What the frame's drawing put about a hex's centre. */
function marksOn(calls: readonly DrawCall[], hex: Hex): Marks {
  const centre = hexCenter(hex);
  const sectors = new Set<number>();
  let centred = false;
  for (const point of pointsNear(calls, centre, CELL_R + CORNER_SLACK)) {
    if (distanceBetween(point, centre) < CENTRE_CLEAR) {
      centred = true;
      continue;
    }
    sectors.add(sectorOf(centre, point));
  }
  return { traced: sectors.size === 6, centred };
}

/**
 * Whether the frame drew a cell on `hex`, and which of the two ways it did.
 *
 * `centreCounts` is whether a mark on the middle is read as a cell here, which it
 * is wherever the field is and, beyond it, only where that is how this build draws
 * its cells.
 */
function cellOn(marks: Marks, centreCounts: boolean): CellReading {
  if (marks.traced) return "traced";
  return centreCounts && marks.centred ? "centred" : "none";
}

/** Every hex at exactly `ring` from the origin, in reading order. */
function ringHexes(ring: number): Hex[] {
  const hexes: Hex[] = [];
  for (let r = -ring; r <= ring; r += 1) {
    for (let q = -ring; q <= ring; q += 1) {
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) === ring) {
        hexes.push(at(q, r));
      }
    }
  }
  return hexes;
}

/** The six neighbours of a hex. */
function neighbours(hex: Hex): Hex[] {
  return [
    at(hex.q + 1, hex.r),
    at(hex.q, hex.r + 1),
    at(hex.q - 1, hex.r + 1),
    at(hex.q - 1, hex.r),
    at(hex.q, hex.r - 1),
    at(hex.q + 1, hex.r - 1),
  ];
}

/** Which ring a hex stands on. */
function ringOf(hex: Hex): number {
  return Math.max(Math.abs(hex.q), Math.abs(hex.r), Math.abs(hex.q + hex.r));
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a cell on the ring-5 hexes and none on the ring-6 hexes beyond them", async () => {
  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();
  await h.advance(1);
  await captureStill(h, "edge");

  const snapshot = await h.snapshot();
  assertLength(
    snapshot.editor.parts,
    0,
    "the machine is empty, so nothing but the field itself is drawn on it",
  );

  const calls = await h.lastCalls();

  const beyond = ringHexes(FIELD_R + 1).filter(cellInsideRegion);
  assertGreaterThan(
    beyond.length,
    0,
    "some ring-6 hex has its whole cell extent inside the field's region",
  );

  // The on-field cells bordering the hexes read, which are the field's outermost.
  const border = new Map<string, Hex>();
  for (const hex of beyond) {
    for (const near of neighbours(hex)) {
      if (ringOf(near) !== FIELD_R) continue;
      if (!cellInsideRegion(near)) continue;
      border.set(`${near.q},${near.r}`, near);
    }
  }
  assertGreaterThan(
    border.size,
    0,
    "the hexes read border cells of the field, which are read the other way round",
  );

  const cells = [...border.values()].map((hex) => ({
    hex,
    marks: marksOn(calls, hex),
  }));
  for (const { hex, marks } of cells) {
    assertNotEqual(
      cellOn(marks, true),
      "none",
      `(${hex.q}, ${hex.r}) is on the field, so a cell is drawn on it: the ` +
        "frame's drawing either names a point in each of its six corner sectors " +
        "or marks its centre",
    );
  }

  const outside = beyond.map((hex) => ({ hex, marks: marksOn(calls, hex) }));
  for (const { hex, marks } of outside) {
    assertEqual(
      cellOn(marks, false),
      "none",
      `(${hex.q}, ${hex.r}) is outside max(|q|, |r|, |q + r|) <= FIELD_R, so no ` +
        "cell is traced on it: the frame's drawing reaches into fewer than all " +
        "six of its corner sectors",
    );
  }

  // Whether a mark on the middle is how this build draws a cell, which is what it
  // is when every cell read carries one.
  const dotsCells = cells.every(({ marks }) => marks.centred);
  if (dotsCells) {
    assertLessThan(
      outside.filter(({ marks }) => marks.centred).length,
      outside.length,
      `this build marks the middle of every cell of the field, so the ${outside.length} ` +
        "hexes read beyond max(|q|, |r|, |q + r|) <= FIELD_R do not all carry a " +
        "mark of their own: there is no ninety-second ring to draw",
    );
  }
});
