// presentation/vehicles-read-apart — each of the three vehicles reads apart from
// the ice band it slides along.
//
// specs/overview.md's legibility table: "The three vehicles read apart from one
// another" and every hazard reads apart from the band it is on. This point is
// the second half of that for the ice band: a plow, a dogsled and a car each
// against the ice around it. A build that draws a vehicle in the ice's own tone
// hands the player a band whose hazards are invisible until one arrives.
//
// THREE KINDS, EACH READ ON ITS OWN, because a build that separates its plow and
// loses its car is exactly the build this point exists to catch, and a failure
// has to name which kind went wrong.
//
// EACH PAIR IS ON THE SAME ROW, so the two samples differ in the vehicle and in
// nothing else — not in the band's own shading and not in a gradient down the
// strait. Each vehicle is posed at one end of its row and the bare ice is read
// several tiles clear of it, so neither sample falls on the other's edge.
//
// THE SAMPLE IS TAKEN AT A TILE THE VEHICLE FILLS. The two multi-tile kinds are
// read on an inner tile of their span rather than at an end of it, so the
// reading is the vehicle's own body rather than the seam where its art meets the
// ice.
//
// WHAT IS READ IS A DISTANCE, NEVER A COLOUR. Floe fixes no palette, so each
// reading is between two things the build itself drew.
//
// AND IT IS READ PER PIXEL, not as a cluster average. specs/assets.md seeds
// every vehicle as pixel art with a transparent background, so much of the tile
// its frame is drawn over is the ice showing through, and averaging the vehicle
// together with the ice it is meant to be told apart from washes the vehicle
// away — `./body.ts` says the same of the bodies. What is asserted is how MUCH
// of the tile reads apart.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { ITEM_LEN } from "../constants";
import {
  captureStill,
  createHarness,
  poseLane,
  sampleTile,
  startCrossing,
  type Harness,
} from "../harness";
import { bodyDistances, fractionAtLeast } from "./body";
import { rasterOf } from "./raster";
/**
 * How far the two readings must sit apart, as an RGB distance out of about `441`.
 *
 * `60` is a seventh of the cube's longest diagonal: the figure this review item
 * states, and the same one the bodies are held to
 * (`presentation/critter-reads-apart`). It is a DISTANCE — no colour, no channel
 * and no palette entry is asserted here, because specs/overview.md fixes none:
 * "The palette, the type, and every other aspect of the look are yours".
 */
const DISTINCT_MIN = 60;

/**
 * How much of a vehicle's tile must read that far from the ice.
 *
 * A tenth, the same fraction and for the same reason as
 * `presentation/critter-reads-apart`: specs/assets.md seeds every frame with a
 * transparent background, so part of the tile is always the band showing
 * through and no honest reading can ask for the whole of it. A tenth is inside
 * what the seeded art itself covers, and far above the stray pixel a build could
 * leave behind while drawing nothing a player could see.
 */
const READS_APART_COVERAGE = 0.1;

/** Where each vehicle's left edge is posed on its own row. */
const AT_COL = 8;

/** How far clear of a vehicle the bare ice beside it is read. */
const CLEAR_TILES = 6;

/** The three kinds, each on a row of the ice band with nothing else on it. */
const KINDS = [
  { kind: "plow", row: 12 },
  { kind: "dogsled", row: 14 },
  { kind: "car", row: 16 },
] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws each vehicle apart from the ice band around it", async () => {
  // An emptied strait: `startCrossing` clears both rosters, so the only vehicles
  // on the ice band are the three posed here.
  startCrossing(h);
  h.debug.removeCritter();
  for (const { kind, row } of KINDS) {
    poseLane(h, row, kind, [AT_COL]);
  }
  await h.advance(1);
  // Before the assertions, so a failing verdict leaves the picture of the three
  // vehicles on the ice they were read against.
  captureStill(h, "scene");

  for (const { kind, row } of KINDS) {
    // An inner tile of the span for the kinds that cover more than one, so the
    // reading is the vehicle's body rather than the seam at its end.
    const onCol = AT_COL + Math.floor((ITEM_LEN[kind] - 1) / 2);
    const bareCol = AT_COL + ITEM_LEN[kind] + CLEAR_TILES;
    const ice = sampleTile(h, bareCol, row);
    const over = bodyDistances(rasterOf(h), onCol, row, ice);

    assertGreaterThanOrEqual(
      fractionAtLeast(over, DISTINCT_MIN),
      READS_APART_COVERAGE,
      `the share of the ${kind}'s tile at column ${onCol} of row ${row} drawn ` +
        `at least ${DISTINCT_MIN} of 441 from the bare ice at column ` +
        `${bareCol} of the same row — a vehicle reads apart from the band it ` +
        `slides along (specs/overview.md); its farthest pixel measured ` +
        `${(over[over.length - 1] ?? 0).toFixed(0)}`,
    );
  }
});
