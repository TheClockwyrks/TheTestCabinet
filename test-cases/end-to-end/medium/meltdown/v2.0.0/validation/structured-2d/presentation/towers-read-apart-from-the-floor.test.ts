// presentation/towers-read-apart-from-the-floor — a tower is drawn on the
// footprint it stands on.
//
// THE RULE. specs/overview.md's legibility table: "A tower reads apart from the
// floor behind it." A tower's drawing changes with its heat (the same table's
// first row), so a build could draw a tower at one end of the ramp and nothing at
// the other; the reading is therefore taken at the cold end, at the middle of the
// scale, and just under the trip, and every one of the eight towers
// specs/towers.md rosters is read, because every one of them is a tower.
//
// WHY THE READING IS A REMOVAL. specs/overview.md fixes no palette — "The
// palette, the type, the glow, and every other aspect of the look are yours" — so
// how far a tower's colour sits from a floor colour is the reviewer's to judge
// and not a figure any check may invent. What a check can decide is whether the
// build drew a tower there at all, and specs/instrumentation.md gives it the
// operation that answers that: the body is read with the tower standing and again
// after the towers have been cleared away, and the tower is what disappeared.
// Every other thing the build drew on that patch — its floor art, its plate
// texture, its grid — is identical in the two frames and cancels exactly.
//
// HOW MUCH MOVEMENT COUNTS. Measured rather than assumed. The same points are
// read on two frames with the tower standing, which is how far the picture moves
// on its own under a build that animates its glow, and the removal has to beat
// that by `NOISE_MARGIN`.
//
// WHERE THE READING IS TAKEN. The body ring of presentation/read.ts, well inside
// the footprint: specs/instrumentation.md says removing a tower reopens its tiles
// and repaths, so a build that tints a build zone or draws a route overlay moves
// pixels at the footprint's EDGE for reasons other than the tower, and the ring
// sits a long way inside it.
//
// WHAT IT DOES NOT DECIDE. Whether the drawing tracks the heat is
// `heat-glow-ramp`; whether a tripped tower is drawn apart from an online one is
// `tripped-reads-apart`; whether the tower sits where the tile map puts it is
// `floor.tile-map`. Nothing here asserts a shape, a label or an outline.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  sizeOf,
  startRun,
  type Harness,
  type TowerType,
} from "../harness";
import { poseStillTower } from "./pose";
import { isEmitter } from "./roster";
import {
  NOISE_MARGIN,
  bodyRing,
  largestShift,
  readPoints,
  type Point,
} from "./read";

/** The three heats the roster is read at: cold, mid-scale, just under the trip. */
const HEATS: readonly number[] = [0, 50, 99];

/** The heat whose frame is kept as the point's picture. */
const SHOWN_HEAT = 50;

/**
 * Where each of the eight stands.
 *
 * Two rows of the floor, every footprint clear of the next, and every one clear
 * of the vent and exhaust runs specs/floor.md fixes.
 */
const ROSTER: readonly { type: TowerType; col: number; row: number }[] = [
  { type: "arc", col: 3, row: 4 },
  { type: "stutter", col: 8, row: 4 },
  { type: "rime", col: 13, row: 4 },
  { type: "flak", col: 18, row: 4 },
  { type: "forge", col: 33, row: 4 },
  { type: "sink", col: 38, row: 4 },
  { type: "bloom", col: 3, row: 24 },
  { type: "lance", col: 10, row: 24 },
];

/** The ring each of the eight is read on, in roster order. */
const RINGS: readonly Point[][] = ROSTER.map(({ type, col, row }) =>
  bodyRing(col, row, sizeOf(type)),
);

/**
 * The whole roster posed at one heat, then taken away: how far each body ring
 * moved when its tower went, and how far it moved on its own beforehand.
 */
async function readRoster(
  h: Harness,
  heat: number,
): Promise<{ gone: number[]; noise: number[] }> {
  startRun(h);
  for (const { type, col, row } of ROSTER) {
    poseStillTower(h, type, col, row, 0, heat);
  }
  await h.advance(1);
  const first = RINGS.map((ring) => readPoints(h, ring));
  await h.advance(1);
  const second = RINGS.map((ring) => readPoints(h, ring));
  if (heat === SHOWN_HEAT) captureStill(h, "towers");

  h.debug.clearTowers();
  await h.advance(1);
  const cleared = RINGS.map((ring) => readPoints(h, ring));

  return {
    gone: second.map((read, index) => largestShift(read, cleared[index])),
    noise: first.map((read, index) => largestShift(read, second[index])),
  };
}

/** The context a failure names: which tower, at what heat, and what was asked. */
function because(type: TowerType, heat: number, noise: number): string {
  return (
    `a ${type} at heat ${heat}: its body ring changes when the tower is taken ` +
    `away, by more than the ${noise} two frames with it standing moved on ` +
    `their own (specs/overview.md: a tower reads apart from the floor behind ` +
    `it)`
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws every emitter on its footprint at every heat", async () => {
  for (const heat of HEATS) {
    const read = await readRoster(h, heat);
    ROSTER.forEach(({ type }, index) => {
      if (!isEmitter(type)) return;
      assertGreaterThanOrEqual(
        read.gone[index],
        read.noise[index] + NOISE_MARGIN,
        because(type, heat, read.noise[index]),
      );
    });
  }
});

it("draws the Forge and the Sink on their footprints", async () => {
  // Both movers carry no heat and report `0` for it forever (specs/heat.md), so
  // one reading is every reading they have.
  const read = await readRoster(h, 0);
  ROSTER.forEach(({ type }, index) => {
    if (isEmitter(type)) return;
    assertGreaterThanOrEqual(
      read.gone[index],
      read.noise[index] + NOISE_MARGIN,
      because(type, 0, read.noise[index]),
    );
  });
});
