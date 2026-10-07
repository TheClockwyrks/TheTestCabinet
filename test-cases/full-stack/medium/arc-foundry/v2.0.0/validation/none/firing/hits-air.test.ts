// firing/hits-air — a flyer inside the radius is a target like any other.
//
// specs/components.md fixes it twice over: "A unit whose position lies within that
// radius is a valid target, ground or flying", and specs/enemies.md, "Every firing
// component hits ground and flying units alike. There is no armor and no damage
// type: a shot removes health from any unit, and no unit resists or is immune."
// specs/enemies.md names the Filament as the one unit that flies.
//
// The yard holds one Capacitor and one Filament, held where it stands inside the
// radius. Nothing about the maze is in play: a flyer "ignores the maze"
// (specs/pathing.md), and holding its travel means the check is about whether the
// structure engages it at all rather than about where it would have flown. What is
// read is the Filament's own health falling and the structure's tally rising, so a
// build that draws a shot at a flyer and applies nothing fails as squarely as one
// that never fires.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import {
  captureReplay,
  createHarness,
  openYard,
  parkUnit,
  standComponent,
  structureById,
  ticks,
  unitById,
  type Harness,
} from "../harness";

const ANCHOR = { col: 10, row: 10 };

/** Inside the Scrap Capacitor's `100`. */
const TARGET_RANGE = 70;

/** How long the flyer is fired on for, in seconds. */
const PATIENCE = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fires on a held Filament in range and takes health off it", async () => {
  await openYard(h, { wave: 1 });
  const id = await standComponent(h, "capacitor", 1, ANCHOR.col, ANCHOR.row);
  const structure = structureById(await h.snapshot(), id);
  const flyer = await parkUnit(h, "filament", {
    x: structure.cx + TARGET_RANGE,
    y: structure.cy,
  });

  const posed = unitById(await h.snapshot(), flyer);
  assertEqual(posed.flying, true, "the Filament flies (specs/enemies.md)");
  const startHp = posed.hp;

  const struck = await captureReplay(h, "air", () =>
    h.until((s) => unitById(s, flyer).hp < startHp, {
      maxFrames: ticks(PATIENCE),
      poll: 1,
    }),
  );

  assertEqual(
    struck.hit,
    true,
    `the Filament losing health within ${PATIENCE}s of standing ` +
      `${TARGET_RANGE} from a firing structure's centre`,
  );
  assertLessThan(
    unitById(struck.snapshot, flyer).hp,
    startHp,
    "the flyer's health after the shot landed",
  );
  assertGreaterThan(
    structureById(struck.snapshot, id).damageDealt,
    0,
    "the structure's damage tally after firing on a flyer",
  );
});
