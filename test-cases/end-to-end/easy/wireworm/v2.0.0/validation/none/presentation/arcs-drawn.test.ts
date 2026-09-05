// Wireworm — presentation/arcs-drawn: a discharge draws lightning between the
// tiles it links.
//
// specs/discharge.md, "Drawing an arc": "An arc is drawn as bright lightning
// joining the centers of the two tiles it links, so a player reads which node
// set off which." The same file reports one arc per link the chain conducted
// along, each naming the two tiles it joined, and gives every arc an `ARC_LIFE`
// (`0.32` s) life. The colour and the form of the lightning are the build's;
// that it runs BETWEEN those two centres is not.
//
// SO THE READING IS THE STRETCH OF BOARD BETWEEN THE TWO REPORTED TILE CENTRES,
// taken twice: while the arc is live and again once its life has run out.
// Something in it must MOVE AT ALL between the two readings — which is to say
// the arc drew something there that the board does not carry on its own.
//
// WHAT "BETWEEN" IS. The box spans the chord and is held one half-tile in from
// each end, so the two tiles the arc joins are outside it and only what runs
// between them is read; on either axis it is never narrower than a tile, which
// is the room specs/discharge.md's "the form of the lightning is yours" needs —
// lightning is drawn jagged, and a form that wandered off the chord entirely
// would no longer read as joining two particular tile centres.
//
// WHY THE CONTROL IS THE SAME BOARD ONCE THE ARC HAS GONE. specs/overview.md
// fixes no palette and leaves the board's look entirely to the build, so a box
// held against some other tile's colour would read a build's own trace as
// lightning. Held against itself, the only thing that can move is what the arc
// drew — and the two nodes the chain detonated are gone from the board on the
// very frame the arc appears (specs/discharge.md removes a detonated node within
// that same update), so they are absent from both readings and cannot be
// mistaken for it.
//
// NO FIGURE IS ASSERTED. `getImageData` returns the bytes that are there, so a
// box the arc drew nothing into comes back byte-identical to itself and measures
// exactly `0`. How brightly the lightning reads is appearance, and the
// reviewer's from the captured still.
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
import { assertGreaterThan, assertLength, assertTrue } from "../assert";
import {
  ARC_LIFE,
  CHARGE_MAX,
  DISCHARGE_RADIUS,
  TILE,
  tileCX,
  tileCY,
} from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  framesFor,
  poseBolt,
  startPlaying,
  type ArcView,
  type Harness,
} from "../harness";
import { readRect, type Patch } from "./reading";

/** The critical node, the charged neighbour, and the bolt's row. */
const CRITICAL_COLUMN = 20;
const CRITICAL_ROW = 10;
const NEIGHBOUR_COLUMN = CRITICAL_COLUMN + DISCHARGE_RADIUS;
const NEIGHBOUR_CHARGE = 1;
const BOLT_ROW = 17;

/**
 * How long the sweep waits for the discharge, in seconds.
 *
 * Half a second is twice the `0.249` s a bolt at `BOLT_SPEED` takes to climb the
 * seven tiles from its posed row into the critical node, so a build whose bolt
 * travels and whose chain runs has reached it with room to spare.
 */
const SWEEP_SECONDS = 0.5;

/** The stretch of stage one arc's lightning is read over, in logical units. */
interface Between {
  arc: ArcView;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * The board between the two tiles an arc links: the chord's own box, held half a
 * tile in from each end so neither linked tile is inside it, and never narrower
 * than a tile on either axis.
 */
function between(arc: ArcView): Between {
  const from = { x: tileCX(arc.from.c), y: tileCY(arc.from.r) };
  const to = { x: tileCX(arc.to.c), y: tileCY(arc.to.r) };
  const halfX = Math.max(TILE / 2, Math.abs(to.x - from.x) / 2 - TILE / 2);
  const halfY = Math.max(TILE / 2, Math.abs(to.y - from.y) / 2 - TILE / 2);
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  return {
    arc,
    x0: midX - halfX,
    y0: midY - halfY,
    x1: midX + halfX,
    y1: midY + halfY,
  };
}

/** How far the furthest pixel of one reading moved against the other. */
function furthestMove(before: Patch, after: Patch): number {
  let furthest = 0;
  for (const [index, pixel] of after.pixels.entries()) {
    const was = before.pixels[index];
    if (was === undefined) continue;
    const moved = colorDistance(pixel, was);
    if (moved > furthest) furthest = moved;
  }
  return furthest;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws lightning between each linked pair of tiles", async () => {
  await startPlaying(h);
  await h.debug.setNode(CRITICAL_COLUMN, CRITICAL_ROW, CHARGE_MAX);
  await h.debug.setNode(NEIGHBOUR_COLUMN, CRITICAL_ROW, NEIGHBOUR_CHARGE);
  await poseBolt(h, CRITICAL_COLUMN, BOLT_ROW);

  const live = await h.until((snapshot) => snapshot.arcs.length > 0, {
    maxFrames: framesFor(SWEEP_SECONDS),
  });
  // The lightning joining the linked tiles, on the frame it first appeared.
  await captureStill(h, "arcs");

  assertTrue(
    live.hit,
    `a bolt into the critical node at (${CRITICAL_COLUMN}, ${CRITICAL_ROW}) ` +
      `to detonate it and chain to the charged node ${DISCHARGE_RADIUS} tiles ` +
      `away, so the snapshot reports the arc that link conducted along ` +
      `(specs/discharge.md); nothing was reported within ${SWEEP_SECONDS} s`,
  );

  const spans = live.snapshot.arcs.map(between);
  const drawn: Patch[] = [];
  for (const span of spans) {
    drawn.push(await readRect(h, span.x0, span.y0, span.x1, span.y1));
  }

  // The same stretches of the same board once every arc's life has run out: the
  // control each reading above is held against.
  await h.advance(framesFor(ARC_LIFE) + 1);
  assertLength(
    (await h.snapshot()).arcs,
    0,
    `every arc gone once ARC_LIFE (${ARC_LIFE} s) has run out ` +
      `(specs/discharge.md)`,
  );
  const bare: Patch[] = [];
  for (const span of spans) {
    bare.push(await readRect(h, span.x0, span.y0, span.x1, span.y1));
  }

  for (const [index, span] of spans.entries()) {
    const { arc } = span;
    assertGreaterThan(
      furthestMove(bare[index], drawn[index]),
      0,
      `the arc joining (${arc.from.c}, ${arc.from.r}) to (${arc.to.c}, ` +
        `${arc.to.r}) to carry drawn pixels that differ from what that same ` +
        `board carries once the arc has gone, over the stretch between those ` +
        `two tile centres — x ${span.x0.toFixed(0)}..${span.x1.toFixed(0)}, ` +
        `y ${span.y0.toFixed(0)}..${span.y1.toFixed(0)} ` +
        `(specs/discharge.md: an arc is drawn as bright lightning joining the ` +
        `centers of the two tiles it links)`,
    );
  }
});
