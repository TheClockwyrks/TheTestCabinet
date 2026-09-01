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
// NOTHING DRAWN ON THE STRAIT IS READ TWO WAYS, and both are needed.
//
//   1. THE BODIES THEMSELVES, held to the boundary. specs/assets.md makes the
//      critter, the bear, the three vehicles and the two floes the only things
//      drawn from seeded art, and every one of them is a body of the strait, so
//      the reading is every `drawImage` whose SOURCE is one of those frames: the
//      box it went into lies wholly at or below `HUD_H`. Without this half a
//      build that drew no bodies at all would pass the difference reading below
//      trivially, both counts being its own HUD icons.
//
//      THE CRITTER IS READ APART FROM THE OTHER SIX FOLDERS, because
//      specs/assets.md says a lives icon in the HUD "may reuse one of these
//      frames" — a crosser frame drawn inside the bar is a permitted readout, not
//      the critter, and failing a build for it would fail a build that did
//      exactly what the specification allows. What is held to the boundary
//      instead is the critter's OWN draw, taken as the crosser frame nearest the
//      centre the game reports for it; a lives icon in the bar is hundreds of
//      units further from that centre than a misplaced draw of the critter is.
//
//   2. AND AS A DIFFERENCE, which catches a body a build drew from art of its
//      own. Two straits are drawn, identical in everything the HUD shows — same
//      score, same lives, same level, same timer, same bays, same frame of the
//      same seeded clock — and differing only in whether the four bodies are on
//      the strait at all. Whatever blits reach into the bar in the empty one are
//      the HUD's own; if the populated one reaches into it any more, that is a
//      body drawn where the specification says none is.
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
  nearestSeededFrame,
  poseBear,
  poseLane,
  startCrossing,
  type DrawnImage,
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

/**
 * How far a drawn source may sit from a seeded frame and still BE it, as a mean
 * absolute channel difference out of `255`.
 *
 * One. specs/assets.md has the build render each body from its own folder, so the
 * source of the draw is that PNG and the comparison is an identity: the only
 * thing this allowance covers is the single lossy step of reading a bitmap back
 * out of a canvas. A build that drew a shape of its own measures far more, and is
 * read by the difference half below rather than by this one.
 */
const SOURCE_MATCH_MAX = 1;

/**
 * How far below `HUD_H` a body's drawn box may begin, in stage units.
 *
 * specs/strait.md puts the boundary at exactly `HUD_H`, and the topmost body this
 * scenario poses is centred on row `1`, whose own top edge is a whole tile below
 * it, so a conforming build has thirty-two units of clearance and this bound is
 * not a judgement call. It is `0.5` rather than `0` for one reason only: a build
 * is free to draw a body scaled by a fraction of a unit — a hop's bounce, a
 * bear's lunge — and a box half a unit into the bar is not "drawn in the HUD bar"
 * by any reading, while eighty units into it is.
 */
const HUD_OVERLAP_MAX = 0.5;

/** One draw the frame made from the seeded art, and which folder it came from. */
interface Body {
  folder: string;
  image: DrawnImage;
}

/** Every draw of `h`'s last frame whose source IS a frame of the seeded art. */
async function bodiesOf(h: Harness): Promise<Body[]> {
  const bodies: Body[] = [];
  for (const image of drawnImages(h)) {
    const match = await nearestSeededFrame(image.source);
    if (match.distance <= SOURCE_MATCH_MAX) {
      bodies.push({ folder: match.folder, image });
    }
  }
  return bodies;
}

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

  // 1. The bodies themselves: the bear, the plow and the raft are drawn from
  //    folders no HUD readout may borrow, so each is held to the boundary.
  const reported = populated.snapshot().critter;
  const bodies = await bodiesOf(populated);
  const strait = bodies.filter((body) => body.folder !== "crosser");
  assertGreaterThanOrEqual(
    strait.length,
    3,
    "the bear, the vehicle and the floe this scenario posed, each drawn from " +
      "its seeded folder (specs/assets.md)",
  );
  for (const { folder, image } of strait) {
    assertGreaterThanOrEqual(
      image.y - image.h / 2 + HUD_OVERLAP_MAX,
      HUD_H,
      `the top edge of the ${folder} drawn at (${Math.round(image.x)}, ` +
        `${Math.round(image.y)}), which the HUD bar's ${HUD_H} units are above ` +
        `(specs/strait.md)`,
    );
  }

  //    And the critter's own draw: the crosser frame nearest the centre the game
  //    reports for it, which a lives icon elsewhere in the bar cannot be.
  const crosser = bodies.filter((body) => body.folder === "crosser");
  const away = (image: DrawnImage): number =>
    Math.hypot(image.x - reported.x, image.y - reported.y);
  const critter = crosser.reduce<DrawnImage | null>(
    (nearest, body) =>
      nearest === null || away(body.image) < away(nearest)
        ? body.image
        : nearest,
    null,
  );
  assertGreaterThanOrEqual(
    crosser.length,
    1,
    `a frame of assets/crosser/ drawn for the critter posed on row ` +
      `${CRITTER.row} (specs/assets.md)`,
  );
  if (critter !== null) {
    assertGreaterThanOrEqual(
      critter.y - critter.h / 2 + HUD_OVERLAP_MAX,
      HUD_H,
      `the top edge of the critter's own draw, nearest the centre the game ` +
        `reports for it — the HUD bar's ${HUD_H} units are above the strait ` +
        `(specs/strait.md)`,
    );
  }

  // 2. And as a difference, which catches a body drawn from art of the build's
  //    own rather than from the seeded folders.
  assertEqual(
    blitsInBar(populated),
    blitsInBar(empty),
    `blits reaching into the HUD bar with a critter, a bear, a vehicle and a ` +
      `floe on the strait, against the same crossing with the strait empty ` +
      `(specs/strait.md draws none of the four there)`,
  );
});
