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
// drew — and both detonated nodes are removed by the chain, so they are absent
// from both readings and cannot be mistaken for it.
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
import { ARC_LIFE, CHARGE_MAX, DISCHARGE_RADIUS, TILE } from "../constants";
import { assertGreaterThan, assertLength, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  poseBoltAtTile,
  resetTo,
  startPlaying,
  ticksFor,
  tileCenter,
  type ArcSnapshot,
  type Harness,
} from "../harness";

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
  arc: ArcSnapshot;
  x: number;
  y: number;
  halfX: number;
  halfY: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/**
 * The board between the two tiles an arc links: the chord's own box, held half a
 * tile in from each end so neither linked tile is inside it, and never narrower
 * than a tile on either axis.
 */
function between(arc: ArcSnapshot): Between {
  const from = tileCenter(arc.from.c, arc.from.r);
  const to = tileCenter(arc.to.c, arc.to.r);
  return {
    arc,
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2,
    halfX: Math.max(TILE / 2, Math.abs(to.x - from.x) / 2 - TILE / 2),
    halfY: Math.max(TILE / 2, Math.abs(to.y - from.y) / 2 - TILE / 2),
  };
}

/** Every device pixel of one stretch of board. */
function readBetween(span: Between): Uint8ClampedArray {
  const from = h.device(span.x - span.halfX, span.y - span.halfY);
  const to = h.device(span.x + span.halfX, span.y + span.halfY);
  return h.ctx.getImageData(
    from.x,
    from.y,
    Math.max(1, to.x - from.x),
    Math.max(1, to.y - from.y),
  ).data;
}

/** How far the furthest pixel of one reading moved against the other. */
function furthestMove(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
): number {
  let furthest = 0;
  const length = Math.min(before.length, after.length);
  for (let at = 0; at + 2 < length; at += 4) {
    const moved = Math.hypot(
      after[at] - before[at],
      after[at + 1] - before[at + 1],
      after[at + 2] - before[at + 2],
    );
    if (moved > furthest) furthest = moved;
  }
  return furthest;
}

it("draws lightning between each linked pair of tiles", async () => {
  resetTo(h);
  startPlaying(h);
  h.debug.setNode(CRITICAL_COLUMN, CRITICAL_ROW, CHARGE_MAX);
  h.debug.setNode(NEIGHBOUR_COLUMN, CRITICAL_ROW, NEIGHBOUR_CHARGE);
  poseBoltAtTile(h, CRITICAL_COLUMN, BOLT_ROW);

  const live = await h.until((snapshot) => snapshot.arcs.length > 0, {
    maxFrames: ticksFor(SWEEP_SECONDS),
  });
  // The lightning joining the linked tiles, on the frame it first appeared.
  captureStill(h, "arcs");

  assertTrue(
    live.hit,
    `a bolt into the critical node at (${CRITICAL_COLUMN}, ${CRITICAL_ROW}) ` +
      `to detonate it and chain to the charged node ${DISCHARGE_RADIUS} tiles ` +
      `away, so the snapshot reports the arc that link conducted along ` +
      `(specs/discharge.md); nothing was reported within ${SWEEP_SECONDS} s, ` +
      `which is twice the bolt's climb, and an arc lasts ARC_LIFE ` +
      `(${ARC_LIFE}) s`,
  );

  const spans = live.snapshot.arcs.map(between);
  const drawn = spans.map(readBetween);

  // The same stretches of the same board once every arc's life has run out: the
  // control each reading above is held against.
  await h.advance(ticksFor(ARC_LIFE) + 1);
  assertLength(
    h.snapshot().arcs,
    0,
    `every arc gone once ARC_LIFE (${ARC_LIFE} s) has run out ` +
      `(specs/discharge.md)`,
  );
  const bare = spans.map(readBetween);

  spans.forEach((span, index) => {
    const { arc } = span;
    assertGreaterThan(
      furthestMove(bare[index], drawn[index]),
      0,
      `the arc joining (${arc.from.c}, ${arc.from.r}) to (${arc.to.c}, ` +
        `${arc.to.r}) to carry drawn pixels that differ from what that same ` +
        `board carries once the arc has gone, over the stretch between those ` +
        `two tile centres — ${(2 * span.halfX).toFixed(0)} by ` +
        `${(2 * span.halfY).toFixed(0)} units about (${span.x.toFixed(0)}, ` +
        `${span.y.toFixed(0)}) (specs/discharge.md: an arc is drawn as bright ` +
        `lightning joining the centers of the two tiles it links)`,
    );
  });
});
