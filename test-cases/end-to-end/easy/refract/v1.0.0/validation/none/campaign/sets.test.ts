// Refract — campaign/sets: the select frame labels its four rows SET A to
// SET D, and a set is a grouping only.
//
// specs/modes/campaign.md: "Each row is labelled with its set's entry in
// SET_LABELS (SET A, SET B, SET C, SET D), in that order from the top row
// down", and "A set is a grouping the select screen shows and labels. It has
// no gate of its own: the unlock rule below is the only thing that governs
// what a player can enter." Both halves are read here: the labels off the
// frame's text draws, each anchored nearest its own row's band of number
// draws — and the gate's absence by really solving all of Set A and finding
// board 7, the first of Set B, unlocked by the ordinary rule alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { SET_LABELS } from "../constants";
import {
  captureStill,
  createHarness,
  driveCourse,
  fireAction,
  textDraws,
  type Harness,
} from "../harness";
import { numberDraws, rowCenters } from "./reading";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the four set labels on their own rows, and a set gates nothing", async () => {
  // Solve all six boards of Set A, then return to the grid.
  await driveCourse(h, 6);
  await fireAction(h, "back");

  const calls = await h.frameCalls();
  await captureStill(h, "select");

  // Crossing the set boundary took nothing but the unlock rule: solving
  // board 6 unlocked board 7, the first board of Set B.
  const grid = await h.snapshot();
  assertEqual(grid.screen, "select", "the grid is up after Set A");
  assertEqual(
    grid.unlockedCount,
    7,
    "solving all of Set A unlocks board 7: the set boundary gates nothing",
  );

  // All four labels are drawn, each aligned with its own row band.
  const draws = textDraws(calls);
  const rows = rowCenters(numberDraws(draws));
  for (const [index, label] of SET_LABELS.entries()) {
    const found = draws.filter((draw) =>
      draw.text.toUpperCase().includes(label),
    );
    assertGreaterThan(found.length, 0, `the select frame draws ${label}`);
    const distances = rows.map((rowY) => Math.abs(found[0].y - rowY));
    assertEqual(
      distances.indexOf(Math.min(...distances)),
      index,
      `${label} sits nearest its own row of the grid, row ${index + 1}`,
    );
  }
});
