// Meltdown — heat/edge-tiles-count: a face sheds per edge-tile.
//
// `specs/heat.md` counts air cooling per EDGE-TILE, not per face: "a face is one
// edge-tile long per tile of the footprint's side, so a 2x2 face is two
// edge-tiles and a 4x4 face is four", and the air term multiplies `RAD_K` by
// `radiatorEdges(T)`. So the same kind of face on a bigger footprint sheds
// proportionally more.
//
// THE TWO ARRANGEMENTS. A tower is walled on three of its four faces, leaving
// one RADIATOR face on air, and the two towers differ in the length of that
// face: a 4x4 Lance's is four edge-tiles and a 2x2 Arc's is two
// (`specs/towers.md` gives both their sizes and their radiator faces, which
// include N in each case). At heat `80`:
//
//   - the Lance's open face: `3.6 * 4 * 0.80` = `11.52` per second;
//   - the Arc's open face:   `3.6 * 2 * 0.80` = `5.76` per second.
//
// MASS IS DIVIDED BACK OUT BEFORE THE COMPARISON. `specs/heat.md` divides every
// change by the tower's thermal mass, and the Lance's `2.8` is not the Arc's
// `1.0`, so the reading is `loss * mass / dt` — the air term the specification
// states, with the division the specification also states undone. That mass
// divides a loss at all is `heat/mass-divides-the-cooling`'s requirement; what
// this item decides is that the air term counts edge-tiles, and the ratio of the
// two air terms is exactly the ratio of the two face lengths, `4 / 2`.
//
// A build that sheds per FACE rather than per edge-tile reads a ratio of `1`.
//
// The walls stand at each subject's own heat, so nothing conducts through them,
// and each reading is one frame, so the walls' own cooling cannot reach the
// subject. Each arrangement is posed on a floor of its own.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertGreaterThan } from "../assert";
import { type Side, type TowerType } from "../constants";
import { BOXED_SITE } from "../fixtures";
import {
  captureStill,
  createHarness,
  poseIdleTower,
  requireTower,
  seconds,
  startRun,
  type Harness,
} from "../harness";
import { wallFaces } from "./faces";
import { massOf } from "./roster";
import { sizeOf } from "../thermal";

/** The wide footprint and the narrow one, both with N among their radiators. */
const WIDE: TowerType = "lance";
const NARROW: TowerType = "arc";

/** The face left on air, a radiator face on both towers (`specs/towers.md`). */
const OPEN_SIDE: Side = "N";

/** The heat both are posed at; it is the same, so it cancels in the ratio. */
const HEAT = 80;

/** The frame each reading is taken over, in seconds of game time. */
const DT = seconds(1);

/** What the edge-tile rule requires of the ratio: 4 edge-tiles over 2. */
const EXPECTED_RATIO = sizeOf(WIDE) / sizeOf(NARROW);

/**
 * How close the ratio must come, as decimal places.
 *
 * Two places is `0.005`, a quarter of one percent of the `2` required. Each air
 * term is one frame of a build's own arithmetic over figures the specification
 * states exactly, so a conformant build lands on `2` to within float slack. The
 * bound is two hundred times smaller than the distance to the wrong model this
 * item exists to name: shedding per face reads `1`.
 */
const RATIO_DIGITS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * The air term one frame reveals on `type`: the heat it lost, multiplied by the
 * mass `specs/heat.md` divided it by, over the frame's own length.
 *
 * Posed with `OPEN_SIDE` on air and its other three faces walled at its own
 * heat by towers of its own size, so each wall covers a whole face.
 */
async function airTermOf(type: TowerType): Promise<number> {
  await startRun(h);
  const site = BOXED_SITE;
  const id = await poseIdleTower(h, type, site.col, site.row, { heat: HEAT });
  const walled = (["N", "E", "S", "W"] as const).filter(
    (side) => side !== OPEN_SIDE,
  );
  await wallFaces(h, { type, col: site.col, row: site.row }, walled, {
    wall: type,
    heat: HEAT,
  });

  const opened = requireTower(await h.snapshot(), id, `the ${type}`).heat;
  await h.advance(1);
  const closed = requireTower(await h.snapshot(), id, `the ${type}`).heat;
  return ((opened - closed) * massOf(type)) / DT;
}

it("A face sheds per edge-tile", async () => {
  const wideTerm = await airTermOf(WIDE);
  const narrowTerm = await airTermOf(NARROW);
  await captureStill(h, "edges");

  assertGreaterThan(
    narrowTerm,
    0,
    `the ${NARROW}'s open ${OPEN_SIDE} face really sheds`,
  );
  assertCloseTo(
    wideTerm / narrowTerm,
    EXPECTED_RATIO,
    RATIO_DIGITS,
    `the ${WIDE}'s open ${OPEN_SIDE} face against the ${NARROW}'s, which ` +
      `specs/heat.md counts as ${sizeOf(WIDE)} edge-tiles against ` +
      `${sizeOf(NARROW)}`,
  );
});
