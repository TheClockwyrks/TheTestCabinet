// yard/housings-fixed-blocked — The Transformer Yard's two housings are
// Fixed-blocked tiles: nothing is ever built on them, and the chain still has an
// open route around both.
//
// A Fixed-blocked tile is the one tile state the player can never change
// (`specs/yard.md`), and the housings are what make this map a different puzzle
// from the other two rather than the same yard with different waypoints. A build
// that draws them and does not block them turns the map's whole topology back
// into an open field; one that blocks them and seals the chain makes the map
// unplayable from its first frame.
//
// Both halves are read here, because they are the same requirement: the tiles are
// impassable AND a route around them exists on an empty yard.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import { mapById } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  type Harness,
} from "../harness";

/** The map whose housings are under test. */
const MAP = "transformer";

/**
 * Anchors taken against each housing: one wholly inside it, and one half on it,
 * so a build that tests the anchor tile alone is caught as well as one that
 * tests nothing.
 */
const ATTEMPTS = [
  { how: "wholly inside the first housing", col: 14, row: 8 },
  { how: "half onto the first housing", col: 11, row: 8 },
  { how: "wholly inside the second housing", col: 32, row: 22 },
  { how: "half onto the second housing", col: 29, row: 22 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses every placement on a housing, and still routes around both", async () => {
  await openYard(h, { map: MAP });

  const opened = await h.snapshot();
  assertEqual(opened.map, MAP, "the map the run opened on");

  // The chain has an open ground route around both housings on an empty yard, so
  // the maze length is a real figure rather than the absence of one.
  assertTrue(
    Number.isFinite(opened.mazeLength),
    `snapshot().mazeLength to be a route length in tiles on an empty ` +
      `${mapById(MAP).name}, whose chain has an open route around both housings`,
  );
  assertGreaterThan(
    opened.mazeLength,
    0,
    "snapshot().mazeLength on an empty Transformer Yard",
  );

  for (const attempt of ATTEMPTS) {
    await h.debug.placeBlocker(attempt.col, attempt.row);
    assertEqual(
      (await h.snapshot()).structures.length,
      0,
      `the yard to stay empty after a placement anchored at ` +
        `(${attempt.col}, ${attempt.row}), ${attempt.how} — its tiles are ` +
        `Fixed-blocked and never change state (specs/yard.md)`,
    );
  }

  await h.advance(1);
  await captureStill(h, "housings");
});
