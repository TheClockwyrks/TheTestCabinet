// load/roster-speed — each Load type travels at the speed its roster row gives.
//
// `specs/enemies.md`'s roster fixes five figures per type, and each is a
// requirement of its own: a build that pays the wrong bounty and a build that
// walks a type at the wrong speed have missed different things, and a grade that
// named "the roster" would say neither. So each figure is decided by a check of
// its own, table-driven over the six types the roster carries, because one type's
// figure is read exactly the way the next one's is. The fifth, base health, is the
// one the per-wave scaling multiplies and has three checks of its own.
//
// THIS ONE IS ABOUT THE SPEED. It is on the snapshot, as `baseSpeed` — the roster figure —
// and `speed`, what the unit is moving at after any slow. Both are read off a unit
// the spawner has just released and nothing has touched: no travel hold, no slow,
// and no structure on the yard, because the roster's speed is what a unit MOVES at
// and a unit that has been held is not one that is moving.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { LOAD_ROSTER } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  type Harness,
} from "../harness";
import { travelling } from "./vitals";

/** A thousandth of a unit: floating point, not a rule about the game. */
const DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("travels each roster type at its roster speed", async () => {
  for (const def of LOAD_ROSTER) {
    // One unit on an empty yard, so nothing can slow it and nothing can shoot it.
    openYard(h, { wave: 1 });
    const walking = travelling(h, def.type);
    assertCloseTo(
      walking.baseSpeed,
      def.speed,
      DIGITS,
      `a ${def.type}'s roster speed`,
    );
    assertCloseTo(
      walking.speed,
      def.speed,
      DIGITS,
      `a ${def.type} carrying no slow moves at its roster speed`,
    );
  }
  await h.advance(1);
  captureStill(h, "speed");
});
