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
// CENTRES, at each of five stations along it, taken twice: while the arc is live
// and again once its life has run out. Something at each station must move more
// than `DISTINCT_MIN` of 441 between the two readings — which is to say the arc
// drew something there that the board does not carry on its own. Lightning is
// jagged by nature and the specification says the form is the build's, so
// "there" allows `WANDER_MAX` — a third of a tile — of wander off the straight
// chord. A build whose lightning wanders further than that no longer reads as
// joining two particular tile centres, which is what the file asks it to do.
//
// WHY THE CONTROL IS THE SAME BOARD ONCE THE ARC HAS GONE. specs/overview.md
// fixes no palette and leaves the board's look entirely to the build, so a disc
// held against some other tile's colour would read a build's own trace as
// lightning. Held against itself, the only thing that can move is what the arc
// drew — and the two nodes the chain detonated are gone from the board on the
// very frame the arc appears (specs/discharge.md removes a detonated node within
// that same update), so they are absent from both readings and cannot be
// mistaken for it.
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
  createHarness,
  framesFor,
  poseBolt,
  startPlaying,
  type ArcView,
  type Harness,
} from "../harness";
import { furthestChange, readDisc, type Patch } from "./reading";

/**
 * How far the drawn lightning must move the board, as a Euclidean RGB distance
 * out of the `441` an RGB cube is across.
 *
 * The case's figure, since the specification states the rule — "bright
 * lightning" — and leaves the colour to the build: `40` is about a tenth of the
 * space, which is the least a player reads at a glance, and far above the
 * nothing that separates two readings of one unchanged pixel.
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

/** Where one station of one arc sits on the stage. */
interface Station {
  arc: ArcView;
  along: number;
  x: number;
  y: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws lightning along the chord joining each linked pair of tiles", async () => {
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

  const stations: Station[] = [];
  for (const arc of live.snapshot.arcs) {
    const from = { x: tileCX(arc.from.c), y: tileCY(arc.from.r) };
    const to = { x: tileCX(arc.to.c), y: tileCY(arc.to.r) };
    for (const along of STATIONS) {
      stations.push({
        arc,
        along,
        x: from.x + (to.x - from.x) * along,
        y: from.y + (to.y - from.y) * along,
      });
    }
  }

  const drawn: Patch[] = [];
  for (const station of stations) {
    drawn.push(await readDisc(h, station.x, station.y, WANDER_MAX));
  }

  // The same discs of the same board once every arc's life has run out: the
  // control each reading above is held against.
  await h.advance(framesFor(ARC_LIFE) + 1);
  assertLength(
    (await h.snapshot()).arcs,
    0,
    `every arc gone once ARC_LIFE (${ARC_LIFE} s) has run out ` +
      `(specs/discharge.md)`,
  );
  const bare: Patch[] = [];
  for (const station of stations) {
    bare.push(await readDisc(h, station.x, station.y, WANDER_MAX));
  }

  for (const [index, station] of stations.entries()) {
    const { arc, along } = station;
    const moved = furthestChange(
      bare[index],
      drawn[index],
      station.x,
      station.y,
      WANDER_MAX,
    );
    assertGreaterThan(
      moved.distance,
      DISTINCT_MIN,
      `the arc joining (${arc.from.c}, ${arc.from.r}) to (${arc.to.c}, ` +
        `${arc.to.r}) to carry drawn pixels more than ${DISTINCT_MIN} of 441 ` +
        `from what that same board carries once the arc has gone, within ` +
        `${WANDER_MAX} units of the point ${along} of the way along the chord ` +
        `between those two tile centres, (${station.x.toFixed(0)}, ` +
        `${station.y.toFixed(0)}) (specs/discharge.md: an arc is drawn as ` +
        `bright lightning joining the centers of the two tiles it links)`,
    );
  }
});
