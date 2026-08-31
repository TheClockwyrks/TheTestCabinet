// presentation/ground-flyer-boss-read-apart — a ground unit, a flyer and the boss
// are drawn apart from one another.
//
// THE RULE. `specs/overview.md`'s legibility table: "Ground units, flyers, and the
// boss read apart from one another". `specs/surge.md` says which is which: the
// Mote "is the baseline" ground unit, "the Drift is the flyer, and it ignores the
// maze entirely", and "the Core is the boss". Those three, drawn at once, read
// plainly apart in all three pairs — because a player who cannot tell a flyer from
// a walker cannot tell which of the two the Flak, which "targets flyers alone"
// (`specs/towers.md`), will answer.
//
// WHY THREE PAIRS AND NOT ONE READING. The requirement is that the three kinds are
// told apart from ONE ANOTHER, so all three pairs are asserted, each named. A build
// that draws its boss apart but its flyer in the walkers' colour fails on the pair
// it got wrong and says so, rather than failing as "the surge".
//
// WHERE THEIR PIXELS ARE, AND WHY NO COLOUR IS NAMED. `specs/surge.md` fixes a
// unit's centre and nothing about its size or shape, and `specs/overview.md` fixes
// no palette. So each unit's reading is the pixel on its centre patch furthest
// from the floor beneath it (`read.ts`), and the comparison is a distance between
// two of those, never a colour.
//
// WHY THEY STAND STILL AND SEPARATED. `poseTarget` parks each on a named tile with
// its motion off (`specs/instrumentation.md`), five tiles from the next, so each
// reading is one unit rather than an overlap: a Core is entitled to be drawn large
// and a Swarm small, and nothing here assumes either.
//
// WHAT IT DOES NOT DECIDE. Whether each reads apart from the FLOOR is
// `presentation/surge-reads-apart-from-the-floor`, and whether the Drift FLIES is
// `movers`' and `mazing`'s business, not a matter of how it is drawn.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import type { SurgeType } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  poseTarget,
  requireUnit,
  startRun,
  type Harness,
  type Rgb,
} from "../harness";
import {
  farthest,
  medoid,
  readPixels,
  showRgb,
  unitFloorProbePoints,
  unitPoints,
} from "./read";

/**
 * How far apart two kinds must read, out of the 441 the RGB cube spans.
 *
 * This group's figure for "plainly apart" (`specs/overview.md`), the same one it
 * holds a tower against the floor to. 60 is about a seventh of the scale: below
 * it a build could draw its flyer as a slightly lighter walker and leave a player
 * guessing which of two units on the same tile the Flak will take.
 */
const APART_MIN = 60;

/** The three kinds `specs/surge.md` names, and where each stands. */
const KINDS: readonly { type: SurgeType; kind: string; col: number }[] = [
  { type: "mote", kind: "the ground unit", col: 10 },
  { type: "drift", kind: "the flyer", col: 20 },
  { type: "core", kind: "the boss", col: 30 },
];

/** The rank they stand on: clear of the casing and of both corridors. */
const ROW = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a Mote, a Drift and a Core apart from one another", async () => {
  await startRun(h);
  const ids: number[] = [];
  for (const { type, col } of KINDS) {
    ids.push(await poseTarget(h, type, col, ROW));
  }
  await h.debug.setPhase("wave");
  await h.advance(1);
  await captureStill(h, "kinds");

  const snapshot = await h.snapshot();
  const colours: Rgb[] = [];
  for (const [index, { type }] of KINDS.entries()) {
    const unit = requireUnit(snapshot, ids[index], `the ${type}`);
    const body = unitPoints(unit);
    const probes = unitFloorProbePoints(unit);
    const read = await readPixels(h, [...body, ...probes]);
    colours.push(
      farthest(medoid(read.slice(body.length)), read.slice(0, body.length)),
    );
  }

  for (let a = 0; a < KINDS.length; a += 1) {
    for (let b = a + 1; b < KINDS.length; b += 1) {
      assertGreaterThanOrEqual(
        colorDistance(colours[a], colours[b]),
        APART_MIN,
        `${KINDS[a].kind}, a ${KINDS[a].type} (${showRgb(colours[a])}), ` +
          `against ${KINDS[b].kind}, a ${KINDS[b].type} ` +
          `(${showRgb(colours[b])}) (specs/overview.md: ground units, flyers ` +
          `and the boss read apart from one another)`,
      );
    }
  }
});
