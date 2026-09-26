// Meltdown — heat/casing-and-openings-are-air: the casing and the openings shed as air.
//
// `specs/heat.md` classifies a perimeter edge-tile by what lies immediately
// outside it, and puts three things in the same row of the table: "Open floor, an
// opening, or the casing — It sheds heat to air." So a face pressed against the
// casing wall and a face looking out through a vent both shed exactly what a
// face on empty floor sheds, and neither is a special case a build may treat as
// blocked or as a hole.
//
// THREE ARCS, ONE FRAME, ONE FIGURE. Each is a lone 2x2 Arc at heat `80` with
// all four faces on something that sheds, so each must lose
// `(3.6 * 4 + 1.1 * 4) * 0.80` per second — the `15.04` of
// `heat/air-cooling-rate` — and the three readings differ only in what the
// tower's west face looks out onto:
//
//   - a quiet anchor well inside the floor, where all four faces are open floor;
//   - the floor's west edge at `col 0`, where the west edge-tiles face the
//     casing (`specs/floor.md`: the casing is not part of the tile grid);
//   - the floor's west edge on the left vent's own rows, where the west
//     edge-tiles face the opening cut into that casing (`specs/floor.md` puts the
//     left vent on rows 16 through 19).
//
// A build that treats the casing as a wall of towers reads `9.28` on the second,
// and one that treats an opening as neither floor nor casing reads something else
// again on the third. The three stand far enough apart that none conducts with
// another, and all three are idle, so no gun adds heat while the loss is read.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import {
  BASE_K,
  LEFT_VENT_ROWS,
  RAD_K,
  TRIP_HEAT,
  type Tile,
} from "../constants";
import { FREE_SITE } from "../fixtures";
import {
  captureStill,
  createHarness,
  poseIdleTower,
  requireTower,
  seconds,
  startRun,
  type Harness,
} from "../harness";

/** The emitter read, and the heat all three are posed at. */
const TOWER = "arc";
const HEAT = 80;

/** The three anchors, and what each one's west face looks out onto. */
const OPEN_FLOOR: Tile = FREE_SITE;
const AGAINST_CASING: Tile = { col: 0, row: 4 };
const ACROSS_THE_VENT: Tile = { col: 0, row: LEFT_VENT_ROWS[0] };

/** `(3.6 * 4 + 1.1 * 4) * 0.80` per second, which is 15.04 (`specs/heat.md`). */
const EXPECTED_RATE = (RAD_K * 4 + BASE_K * 4) * (HEAT / TRIP_HEAT);

/** The frame the rates are measured over, in seconds of game time. */
const DT = seconds(1);

/**
 * How close each measured rate must come, as decimal places of heat per second.
 *
 * One place is `0.05` of a heat point per second, a third of one percent of the
 * `15.04` required. Each reading is one frame of a build's own arithmetic over
 * figures the specification states exactly, so a conformant build needs none of
 * the room; the bound is a hundred times smaller than the distance to the wrong
 * model this item exists to name — counting the casing as a blocked face reads
 * `9.28`.
 */
const RATE_DIGITS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("The casing and the openings shed as air", async () => {
  await startRun(h);
  const posed: { what: string; id: number }[] = [];
  for (const [what, at] of [
    ["open floor", OPEN_FLOOR],
    ["the casing", AGAINST_CASING],
    ["the left vent's opening", ACROSS_THE_VENT],
  ] as const) {
    posed.push({
      what,
      id: await poseIdleTower(h, TOWER, at.col, at.row, { heat: HEAT }),
    });
  }

  await h.advance(1);
  await captureStill(h, "casing");
  const cooled = await h.snapshot();

  for (const { what, id } of posed) {
    const closed = requireTower(cooled, id, `the Arc against ${what}`).heat;
    assertCloseTo(
      (HEAT - closed) / DT,
      EXPECTED_RATE,
      RATE_DIGITS,
      `heat per second an ${TOWER} at ${HEAT} sheds with its west face on ` +
        `${what}`,
    );
  }
});
