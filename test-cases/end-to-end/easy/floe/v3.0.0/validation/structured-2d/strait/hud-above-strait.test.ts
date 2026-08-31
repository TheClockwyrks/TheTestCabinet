// strait/hud-above-strait — the HUD bar is the strip above the strait, the
// readouts are inside it, and nothing on the strait is drawn there.
//
// specs/strait.md divides the stage into two stacked regions: the HUD bar over
// `y` in `[0, HUD_H]` (`[0, 80]`), carrying "the readouts `specs/ui.md` fixes.
// No critter, bear, vehicle, or floe is drawn here."; and the strait over `y` in
// `[80, 720]`, carrying "All play." specs/ui.md says the same from the other
// side: the five readouts are each "inside the bar", and "Nothing drawn on the
// strait is drawn inside the HUD bar."
//
// So there are two directions, and they are read separately because they fail
// separately: a build can put its readouts below the bar, and a build can draw
// the strait up through it.
//
// THE READOUTS ARE READ BY THE TWO THAT CANNOT BE ANYTHING BUT TEXT. specs/ui.md
// leaves the HUD's "arrangement and styling" to the build, and three of its five
// readouts are things a build may legitimately draw without text at all — the
// lives as a row of marks, the bays as "one mark per bay", a timer as a bar. So
// two are read: the LEVEL readout, whose copy `HUD_LEVEL_LABEL` (`LEVEL`) the
// specification fixes, and the SCORE, posed at a figure no other readout on this
// screen can produce, so the run of text carrying it is found by what it says
// rather than by where it is. Each one's ANCHOR is read — the position the build
// asked for the run of text at — against the bar the specification gives it.
// What each readout SHOWS is the `presentation` category's question; this point
// asks only where the bar is.
//
// NOTHING DRAWN ON THE STRAIT IS READ AS A DIFFERENCE, not as an inventory. The
// four bodies specs/strait.md names — critter, bear, vehicle, floe — are all
// drawn from the seeded sprite art (specs/overview.md's hard requirements), so
// each is a blit; but so, legitimately, is a HUD that letters its lives or its
// bays with art of its own, and no reading of one frame can tell those apart.
// Two straits are therefore drawn instead, identical in everything the HUD shows
// — same score, same lives, same level, same timer, same bays, same frame of the
// same seeded clock — and differing only in whether the four bodies are on the
// strait at all. Whatever blits reach into the bar in the empty one are the
// HUD's own; if the populated one reaches into it any more, that is a body drawn
// where the specification says none is.
//
// THE BODIES ARE POSED AS HIGH AS THEY GO, because the bar is what they would
// spill into: the critter on the cap, row `0`, whose 32-unit frame reaches
// exactly `y = 80` and no further (specs/assets.md), and the vehicle and the
// floe on the top rows their own bands have (specs/strait.md gives the ice band
// rows `11`-`18` and the water band rows `2`-`9`, so neither can be posed nearer
// the bar than that). The bear is posed with all three of its faculties off: this
// point is about where it is DRAWN, and a bear that senses, routes and travels
// would have moved before the frame was taken.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertBetween,
  assertEqual,
  assertGreaterThanOrEqual,
} from "../assert";
import {
  HUD_H,
  HUD_LEVEL_LABEL,
  ICE_TOP,
  ROW_CAP,
  WATER_TOP,
} from "../../src/constants";
import {
  captureStill,
  createHarness,
  drawnImages,
  drawnTextSpans,
  poseBear,
  poseLane,
  startCrossing,
  type Harness,
} from "../harness";

/**
 * The score this scenario poses.
 *
 * A run of digits that appears nowhere else the HUD can put one: not the `3`
 * lives, not level `1` of `8`, and not the crossing timer, which
 * specs/progression.md starts at `30` seconds for level `1`. So the one run of
 * text containing it is the score readout, whatever else the build wrote around
 * it — and EVERY run carrying it is held inside the bar rather than exactly one,
 * because a build is free to draw a readout twice: a fill over a stroke is one
 * outlined score, not two.
 */
const POSED_SCORE = 12345;

/** Where the critter is posed: the cap, the highest row the strait has. */
const CRITTER = { col: 10, row: ROW_CAP };

/** Where the bear is posed: the top row of the ice band, blind and still. */
const BEAR = { col: 30, row: ICE_TOP };

/** Where the vehicle is posed: the top row of the ice band. */
const VEHICLE = { col: 5, row: ICE_TOP, kind: "plow" } as const;

/** Where the floe is posed: the top row of the water band. */
const FLOE = { col: 20, row: WATER_TOP, kind: "raft4" } as const;

let empty: Harness;
let populated: Harness;

beforeEach(async () => {
  empty = await createHarness();
  populated = await createHarness();
});

afterEach(() => {
  empty.dispose();
  populated.dispose();
});

/** How many of a frame's blits reach into the HUD bar. */
function blitsInBar(h: Harness): number {
  return drawnImages(h).filter((image) => image.y - image.h / 2 < HUD_H).length;
}

it("draws the level and score readouts inside the HUD bar", async () => {
  startCrossing(populated);
  populated.debug.setScore(POSED_SCORE);
  populated.calls.length = 0;
  await populated.advance(1);

  // The situation: the run really holds the score the readout is read for.
  assertEqual(
    populated.snapshot().score,
    POSED_SCORE,
    "the posed score, read back (specs/instrumentation.md)",
  );

  const runs = drawnTextSpans(populated);
  const readouts = [
    {
      what: `the ${HUD_LEVEL_LABEL} readout, whose label specs/ui.md fixes`,
      found: runs.filter((span) =>
        span.text.toUpperCase().includes(HUD_LEVEL_LABEL),
      ),
    },
    {
      what: `the score readout, posed at ${POSED_SCORE}`,
      found: runs.filter((span) => span.text.includes(String(POSED_SCORE))),
    },
  ];
  for (const { what, found } of readouts) {
    assertGreaterThanOrEqual(
      found.length,
      1,
      `runs of text carrying ${what} (specs/ui.md)`,
    );
    for (const run of found) {
      assertBetween(
        run.y,
        0,
        HUD_H,
        `the anchor of ${JSON.stringify(run.text)}, carrying ${what}, inside ` +
          `the HUD bar y in [0, ${HUD_H}] (specs/strait.md)`,
      );
    }
  }
});

it("draws no critter, bear, vehicle or floe inside the HUD bar", async () => {
  // The same crossing on both, so every readout the HUD shows is the same
  // figure: level 1, three lives, a score of 0, five open bays, and a timer that
  // is not draining.
  startCrossing(empty);
  empty.debug.removeCritter();

  startCrossing(populated);
  populated.debug.setCritterTile(CRITTER.col, CRITTER.row);
  poseBear(populated, BEAR.col, BEAR.row, {
    sense: false,
    routing: false,
    travel: false,
  });
  poseLane(populated, VEHICLE.row, VEHICLE.kind, [VEHICLE.col]);
  poseLane(populated, FLOE.row, FLOE.kind, [FLOE.col]);

  // One frame each, and the same one: both games have run exactly one tick from
  // the same seeded reset, so anything a build animates is at the same phase in
  // both pictures.
  empty.calls.length = 0;
  populated.calls.length = 0;
  await empty.advance(1);
  await populated.advance(1);
  captureStill(populated, "hud");

  assertEqual(
    blitsInBar(populated),
    blitsInBar(empty),
    `blits reaching into the HUD bar with a critter, a bear, a vehicle and a ` +
      `floe on the strait, against the same crossing with the strait empty ` +
      `(specs/strait.md draws none of the four there)`,
  );
});
