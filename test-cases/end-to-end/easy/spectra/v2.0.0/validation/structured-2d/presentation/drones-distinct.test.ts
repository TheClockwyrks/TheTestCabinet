// Spectra — presentation/drones-distinct: the three drones read apart.
//
// `specs/overview.md`'s legibility table: "A Shard, a Flux, and a Prism are told
// apart from one another." The three ask different things of a player —
// `specs/drones.md` gives the Shard a fixed band, the Flux a rhythm that makes it
// unhittable while it shimmers, and the Prism two layers of opposite bands — so a
// player who cannot tell which is in front of them cannot choose a band to fire.
//
// ALL THREE ARE POSED ON ONE BAND, WHICH IS THE WHOLE POINT OF THE POSE. If the
// three carried different bands, the readings would separate on the band and a
// build that drew all three kinds identically would pass. On one band the only
// thing left that can separate them is what the kind is drawn as, which is the
// requirement.
//
// SO THE READING IS THE PICTURE, HELD PLACE FOR PLACE. Each drone is read through
// a square of the whole Prism's `PRISM_SIZE` (`56`) footprint — the largest of
// the three, so every one of them is read through a square that holds all of it,
// over one extent — and two drones are compared place for place over everything
// either painted, held against the same squares of the same field with the drones
// gone (see `presentation/reading`). Place for place rather than as two mean
// colours, because the three differ in the SHAPE and the EXTENT they are drawn at
// as much as in anything else: `specs/drones.md` draws them at `SHARD_SIZE`
// (`28`), `FLUX_SIZE` (`30`) and `PRISM_SIZE` (`56`), and two drones of one band
// that fill their squares differently are told apart by a player exactly there.
//
// WHY THE TWO BOUNDS DIFFER, AND WHAT EACH ONE IS FOR. Against the field, `40` of
// `441` — this checklist's figure for what a player reads at a glance — because
// `specs/overview.md` states that row outright and a drone that vanishes into the
// field is unplayable. Between two kinds, a far smaller figure, because the
// specification asks that the three be TOLD APART and never that they carry
// different colours: two drones of one band are both that band's colour, and a
// build that drew them in one palette, as `specs/overview.md`'s "One palette for
// both" row requires, is conforming. What is caught is a build that drew two
// kinds as the same picture.
//
// THE FLUX IS POSED MID-HOLD, and the Prism with its shell standing, so each of
// the three is in the state its own footprint figure is stated for. All three are
// props with every faculty off, so none travels, oscillates or fires between the
// pose and the frame that is read.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
} from "../assert";
import { FLUX_HOLD_L1, FLUX_SIZE, PRISM_SIZE, SHARD_SIZE } from "../constants";
import {
  captureStill,
  createHarness,
  poseDrone,
  startPosed,
  type DroneKind,
  type Harness,
} from "../harness";
import {
  PAINT_MIN,
  apartFromField,
  apartness,
  droneOf,
  footprintOf,
  readRegion,
  type Region,
} from "./reading";

/**
 * How far each drone must read from the field behind it, as a Euclidean RGB
 * distance out of the `441` an RGB cube is across.
 *
 * The figure this item is written against: at least `40` of `441`, about a tenth
 * of the space, which is what this checklist calls the least a player reads at a
 * glance.
 */
const FIELD_MIN = 40;

/**
 * How far apart two kinds must read, as the same distance averaged over
 * everything either of them painted.
 *
 * The case's own figure, and deliberately far below `FIELD_MIN`. Two drones of
 * one band ARE both that band's colour — `specs/overview.md` requires one palette
 * for everything that carries a band — so demanding a colour's worth of
 * separation between two same-band drones would fail a conforming build. What the
 * specification does require is that the three be told apart, and a build that
 * drew two kinds as one picture reads `0` here. `PAINT_MIN` (`12`) is this
 * group's figure for the distance below which a place counts as not painted at
 * all, so two pictures differing by less than that on average are not painted
 * differently; `15` sits just above it.
 */
const KINDS_APART_MIN = PAINT_MIN + 3;

/** The row the three stand on: inside the play field, clear of the ship's lane. */
const ROW_Y = 420;

/**
 * The three drones, `380` units apart — more than six whole Prisms — so no glow a
 * build lays around one can reach the square another is read through.
 */
const POSED: readonly { kind: DroneKind; x: number }[] = [
  { kind: "shard", x: 260 },
  { kind: "flux", x: 640 },
  { kind: "prism", x: 1020 },
];

/** The square every one of the three is read through: the largest footprint. */
const READ_SIZE = PRISM_SIZE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the three drones apart from one another and from the field", async () => {
  startPosed(h);
  const ids = POSED.map(({ kind, x }) =>
    poseDrone(h, kind, x, ROW_Y, {
      band: "cyan",
      // Mid-hold, so the Flux is the settled body `FLUX_SIZE` is stated for
      // rather than a shimmer (specs/drones.md).
      bandClock: FLUX_HOLD_L1 / 2,
      shell: true,
    }),
  );
  await h.advance(1);

  // A Shard, a Flux and a Prism side by side.
  captureStill(h, "trio");

  const posed = h.snapshot();
  const read = POSED.map(({ kind }, index) => {
    const drone = droneOf(posed, ids[index]);
    assertEqual(
      drone.effectiveBand,
      "cyan",
      `precondition: the ${kind} reads as cyan on the field, as the other two ` +
        `do (specs/bands.md; no inversion is running)`,
    );
    return { kind, square: footprintOf(drone.x, drone.y, READ_SIZE) };
  });

  const drawn: Region[] = read.map(({ square }) => readRegion(h, square));

  // The same three squares of the same field with no drone on them: the control
  // every reading above is held against.
  h.debug.clearDrones();
  await h.advance(1);
  const bare: Region[] = read.map(({ square }) => readRegion(h, square));

  for (const [index, { kind }] of read.entries()) {
    const apart = apartFromField(bare[index], drawn[index]);
    assertGreaterThanOrEqual(
      apart.distance,
      FIELD_MIN,
      `the ${kind} to read at least ${FIELD_MIN} of 441 from the field behind ` +
        `it, averaged over the ${apart.samples} places it painted ` +
        `(specs/overview.md: each band is told apart from the field behind it)`,
    );
  }

  for (let first = 0; first < read.length; first += 1) {
    for (let second = first + 1; second < read.length; second += 1) {
      const apart = apartness(
        bare[first],
        drawn[first],
        bare[second],
        drawn[second],
      );
      assertGreaterThan(
        apart.distance,
        KINDS_APART_MIN,
        `the ${read[first].kind} and the ${read[second].kind}, both on cyan, ` +
          `to read more than ${KINDS_APART_MIN} of 441 apart, averaged over ` +
          `the ${apart.samples} places either of them painted inside their ` +
          `PRISM_SIZE (${PRISM_SIZE}) squares (specs/overview.md: a Shard, a ` +
          `Flux and a Prism are told apart from one another); their own ` +
          `footprints are SHARD_SIZE (${SHARD_SIZE}) and FLUX_SIZE ` +
          `(${FLUX_SIZE})`,
      );
    }
  }
});
