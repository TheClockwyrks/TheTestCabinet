// Wireworm — presentation/arcs-drawn: a discharge draws lightning between the
// tiles it links.
//
// specs/discharge.md, "Drawing an arc": "An arc is drawn as bright lightning
// joining the centers of the two tiles it links, so a player reads which node
// set off which." The same file reports one arc per link the chain conducted
// along, each naming the two tiles it joined, and gives every arc an `ARC_LIFE`
// (`0.32` s) life. The colour and the form of the lightning are the build's;
// that it joins those two centres is not.
//
// SO THE READING IS THE PIXELS ALONG THE CHORD BETWEEN THE TWO REPORTED TILE
// CENTRES. At each of five stations along it, something must be drawn that no
// bare tile of the same board carries: the pixel nearest that station which sits
// furthest from the board's own colour must sit more than `DISTINCT_MIN` of 441
// away from it. Lightning is jagged by nature and the specification says the
// form is the build's, so "nearest" allows `WANDER_MAX` — a third of a tile — of
// wander off the straight chord. A build whose lightning wanders further than
// that no longer reads as joining two particular tile centres, which is what the
// file asks it to do.
//
// THE ARCS ARE REACHED THE ONLY WAY THEY EXIST: by detonating a critical node. A
// bolt is posed in the critical node's own column seven tiles below it on an
// otherwise empty, quiet board, and the sweep stops on the first frame the
// snapshot reports an arc — which is the frame the render drew it on, and well
// inside `ARC_LIFE`. A build whose discharge never runs, or which reports no
// arc, fails here: there is no picture of lightning to read, and this point ends
// at a verdict either way.
//
// THE CHARGED NEIGHBOUR IS TWO TILES OFF, which is exactly `DISCHARGE_RADIUS`,
// so the chain conducts one link and the snapshot reports one arc — the smallest
// discharge that draws anything, and the one whose chord is unambiguous.

import { afterEach, beforeEach, it } from "vitest";
import { ARC_LIFE, CHARGE_MAX, DISCHARGE_RADIUS, TILE } from "../constants";
import { assertGreaterThan, assertTrue } from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  poseBoltAtTile,
  resetTo,
  sampleTile,
  startPlaying,
  ticksFor,
  tileCenter,
  type Harness,
  type Rgb,
} from "../harness";

/**
 * How far the drawn lightning must sit from the board's own colour, as a
 * Euclidean RGB distance out of the `441` an RGB cube is across. The case's
 * figure, since the specification states the rule — "bright lightning" — and
 * leaves the colour to the build.
 */
const DISTINCT_MIN = 40;

/**
 * How far off the straight chord the lightning may wander, in logical units.
 *
 * A third of a tile. specs/discharge.md leaves the form of the lightning to the
 * build, and lightning is drawn jagged, so the chord is where the arc runs
 * rather than where every one of its pixels lies. Wander wider than this and the
 * arc no longer reads as joining two particular tile centres, which is the one
 * thing the file does fix about the drawing.
 */
const WANDER_MAX = Math.round(TILE / 3);

/** Where along the chord the lightning is looked for, as fractions of it. */
const STATIONS = [0.1, 0.3, 0.5, 0.7, 0.9] as const;

/** The critical node, the charged neighbour, and the bolt's row. */
const CRITICAL_COLUMN = 20;
const CRITICAL_ROW = 10;
const NEIGHBOUR_COLUMN = CRITICAL_COLUMN + DISCHARGE_RADIUS;
const BOLT_ROW = 17;

/** A bare tile of the same row: the board the lightning is read against. */
const BARE_COLUMN = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** The pixel within `WANDER_MAX` of `(x, y)` furthest from `board`. */
function furthestFromBoard(x: number, y: number, board: Rgb): number {
  let furthest = -1;
  for (let dy = -WANDER_MAX; dy <= WANDER_MAX; dy += 1) {
    for (let dx = -WANDER_MAX; dx <= WANDER_MAX; dx += 1) {
      if (dx * dx + dy * dy > WANDER_MAX * WANDER_MAX) continue;
      const [r, g, b] = h.pixel(x + dx, y + dy);
      furthest = Math.max(furthest, colorDistance({ r, g, b }, board));
    }
  }
  return furthest;
}

it("draws lightning along the chord joining each linked pair of tiles", async () => {
  resetTo(h);
  startPlaying(h);
  h.debug.setNode(CRITICAL_COLUMN, CRITICAL_ROW, CHARGE_MAX);
  h.debug.setNode(NEIGHBOUR_COLUMN, CRITICAL_ROW, 1);
  poseBoltAtTile(h, CRITICAL_COLUMN, BOLT_ROW);

  const live = await h.until((snapshot) => snapshot.arcs.length > 0, {
    maxFrames: ticksFor(0.5),
  });
  // The lightning joining the linked tiles, on the frame it first appeared.
  captureStill(h, "arcs");

  assertTrue(
    live.hit,
    `a bolt into the critical node at (${CRITICAL_COLUMN}, ${CRITICAL_ROW}) ` +
      `to detonate it and chain to the charged node ${DISCHARGE_RADIUS} tiles ` +
      `away, so the snapshot reports the arc that link conducted along ` +
      `(specs/discharge.md); nothing was reported within 0.5 s, which is ` +
      `twice the bolt's climb, and an arc lasts ARC_LIFE (${ARC_LIFE}) s`,
  );

  const board = sampleTile(h, BARE_COLUMN, CRITICAL_ROW);
  for (const arc of live.snapshot.arcs) {
    const from = tileCenter(arc.from.c, arc.from.r);
    const to = tileCenter(arc.to.c, arc.to.r);
    for (const station of STATIONS) {
      const x = from.x + (to.x - from.x) * station;
      const y = from.y + (to.y - from.y) * station;
      assertGreaterThan(
        furthestFromBoard(x, y, board),
        DISTINCT_MIN,
        `the arc joining (${arc.from.c}, ${arc.from.r}) to (${arc.to.c}, ` +
          `${arc.to.r}) to carry drawn pixels more than ${DISTINCT_MIN} of ` +
          `441 from the board's own colour within ${WANDER_MAX} units of the ` +
          `point ${station} of the way along the chord between those two tile ` +
          `centres, (${x.toFixed(0)}, ${y.toFixed(0)}) ` +
          `(specs/discharge.md: an arc is drawn as bright lightning joining ` +
          `the centers of the two tiles it links); the bare tile at ` +
          `(${BARE_COLUMN}, ${CRITICAL_ROW}) sampled rgb(` +
          `${board.r.toFixed(0)}, ${board.g.toFixed(0)}, ` +
          `${board.b.toFixed(0)})`,
      );
    }
  }
});
