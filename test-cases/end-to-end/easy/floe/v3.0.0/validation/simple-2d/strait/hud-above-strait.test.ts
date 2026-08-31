// strait/hud-above-strait — the HUD bar is the strip above the strait, and the two
// regions do not trade places.
//
// specs/strait.md divides the stage into exactly two stacked regions: the HUD bar
// over `y` in `[0, HUD_H]` (`[0, 80]`), carrying "the readouts `specs/ui.md`
// fixes" and where "no critter, bear, vehicle, or floe is drawn", and the strait
// below it over `[STRAIT_TOP, STRAIT_TOP + STRAIT_H]` (`[80, 720]`), carrying "all
// play". specs/ui.md says the same from the other side: "Nothing drawn on the
// strait is drawn inside the HUD bar."
//
// SO THE POINT HAS TWO HALVES AND BOTH ARE READ, in the one direction the item
// states: the readouts are inside the bar, and the strait's bodies are not.
//
// HOW "A READOUT IS INSIDE THE BAR" IS READ, AND WHAT IS DELIBERATELY NOT READ.
// specs/ui.md leaves the HUD's "arrangement and styling" to the build, and three
// of its five readouts are things a build may legitimately draw without text at
// all — the lives as a row of marks, the bays as "one mark per bay", a timer as a
// bar. So this check reads the two readouts that cannot be anything but text: the
// LEVEL readout, whose copy `HUD_LEVEL_LABEL` the specification fixes, and the
// SCORE, which is a running number. Each is posed at a value that appears nowhere
// else on the screen, so the run of text carrying it is found by what it says
// rather than by where it is, and the reading is the anchor that run was drawn at,
// mapped through whatever transform was in force. EVERY run carrying it is held
// inside the bar rather than exactly one, because a build is free to draw a label
// twice — a fill over a stroke is one outlined readout, not two.
//
// HOW "NOTHING OF THE STRAIT IS IN THE BAR" IS READ. specs/assets.md makes the
// critter, the bear, the three vehicles and the two floes the only things drawn
// from seeded art, and every one of them is a body of the strait. So the reading
// is every `drawImage` the frame issued whose source IS one of those frames: the
// destination box each was drawn into must lie wholly at or below `HUD_H`.
// Everything else the build draws is its own — the bands, the bays, the bar itself
// — and nothing here constrains it.
//
// THE CRITTER IS READ APART FROM THE OTHER SIX FOLDERS, because specs/assets.md
// says a lives icon in the HUD "may reuse one of these frames" — a crosser frame
// drawn inside the bar is a permitted readout, not the critter, and failing a
// build for it would fail a build that did exactly what the specification allows.
// What is held to the boundary instead is the critter's OWN draw, taken as the
// crosser frame nearest the centre the game reports for it. A build that drew the
// critter from a strait `y` rather than a stage one puts that draw eighty units
// up, inside the bar, and a lives icon elsewhere in the bar is hundreds of units
// further from the critter's reported centre than the misplaced draw is.
//
// THE SCENARIO POSES THE FOUR BODIES AT THE TOP OF THE STRAIT, each on the topmost
// row its own rules allow it: the critter in a bay of row `1`, a bear on row `2`
// (specs/hunter.md keeps a bear off the far shore), a floe on the top water row
// and a vehicle on the top ice row. A build that drew any of them from a strait
// `y` rather than a stage one — the single missing `STRAIT_TOP` — puts them eighty
// units up, inside the bar, and only the topmost bodies show it.

import { afterEach, beforeEach, it } from "vitest";
import { HUD_LEVEL_LABEL } from "../../src/constants";
import { assertBetween, assertGreaterThanOrEqual, fail } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  drawnImages,
  drawnTextSpans,
  identifySprite,
  poseBear,
  poseLane,
  seededFrames,
  startCrossing,
  type DrawnImage,
  type Harness,
} from "../harness";
import { BAY_PAIRS, HUD_H, ICE_TOP, ROW_BAYS, WATER_TOP } from "./harness";

/**
 * The score this scenario poses.
 *
 * A run of digits that appears nowhere else the HUD can put one: not `3` lives,
 * not level `1` of `8`, and not the crossing timer, which specs/progression.md
 * starts at `30` seconds for level `1`. So the one text run containing it is the
 * score readout, whatever else the build wrote around it.
 */
const POSED_SCORE = 12345;

/** The column the critter is posed at: a column of the middle bay of row `1`. */
const BAY_COL = BAY_PAIRS[2][0];

/** The columns the three lane bodies are posed at, well apart from one another. */
const VEHICLE_COL = 10;
const FLOE_COL = 24;
const BEAR_COL = 30;

/**
 * How far below `HUD_H` a body's drawn box may begin, in stage units.
 *
 * specs/strait.md puts the boundary at exactly `HUD_H`, and the topmost body this
 * scenario poses is centred on row `1`, whose own top edge is a whole tile below
 * it, so a conforming build has thirty-two units of clearance and this bound is not
 * a judgement call. It is `0.5` rather than `0` for one reason only: a build is
 * free to draw a body scaled by a fraction of a unit — a hop's bounce, a bear's
 * lunge — and a box half a unit into the bar is not "drawn in the HUD bar" by any
 * reading, while eighty units into it is.
 */
const HUD_OVERLAP_MAX = 0.5;

/** One draw the frame made from the seeded art, and which folder it came from. */
interface Body {
  folder: string;
  image: DrawnImage;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the readouts inside the HUD bar and none of the strait's bodies there", async () => {
  const frames = await seededFrames();

  startCrossing(h);
  h.debug.setScore(POSED_SCORE);

  // The four bodies, each as high up the strait as its own rules put it.
  poseLane(h, ICE_TOP, "plow", [VEHICLE_COL]);
  poseLane(h, WATER_TOP, "raft4", [FLOE_COL]);
  h.debug.setCritterTile(BAY_COL, ROW_BAYS);
  poseBear(h, BEAR_COL, WATER_TOP, {
    sense: false,
    routing: false,
    travel: false,
  });

  // One frame, and everything below is read off that one frame's calls.
  const calls = await drawFrame(h);
  captureStill(h, "hud");
  const reported = h.snapshot().critter;

  // The readouts: every run of text carrying each, and the anchor it was drawn at.
  const runs = drawnTextSpans(h, calls);
  const readouts = [
    {
      what: `the ${HUD_LEVEL_LABEL} readout`,
      found: runs.filter((run) =>
        run.text.toUpperCase().includes(HUD_LEVEL_LABEL),
      ),
    },
    {
      what: `the score readout, posed at ${POSED_SCORE}`,
      found: runs.filter((run) => run.text.includes(String(POSED_SCORE))),
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
        `the baseline of "${run.text}", carrying ${what}, inside the HUD bar ` +
          `(specs/strait.md)`,
      );
    }
  }

  // The bodies: every draw whose source is a frame of the seeded art.
  const bodies: Body[] = [];
  for (const image of drawnImages(h, calls)) {
    const match = await identifySprite(image.source, frames);
    if (match !== null) bodies.push({ folder: match.folder, image });
  }

  // The bear, the plow and the raft this scenario posed: three bodies drawn from
  // a folder no HUD readout may borrow. The situation, read before the verdict.
  const strait = bodies.filter((body) => body.folder !== "crosser");
  assertGreaterThanOrEqual(
    strait.length,
    3,
    "the bear, the vehicle and the floe this scenario posed, each drawn from " +
      "its seeded folder (specs/assets.md)",
  );
  for (const { folder, image } of strait) {
    assertGreaterThanOrEqual(
      image.top + HUD_OVERLAP_MAX,
      HUD_H,
      `the top edge of the ${folder} drawn at (${Math.round(image.x)}, ` +
        `${Math.round(image.y)}), which the HUD bar's ${HUD_H} units are above ` +
        `(specs/strait.md)`,
    );
  }

  // The critter's own draw: the crosser frame nearest the centre the game
  // reports for it, which a lives icon elsewhere in the bar cannot be.
  const crosser = bodies.filter((body) => body.folder === "crosser");
  const critter = crosser.reduce<DrawnImage | null>((nearest, body) => {
    const away = Math.hypot(
      body.image.x - reported.x,
      body.image.y - reported.y,
    );
    const best =
      nearest === null
        ? Infinity
        : Math.hypot(nearest.x - reported.x, nearest.y - reported.y);
    return away < best ? body.image : nearest;
  }, null);
  if (critter === null) {
    fail(
      "a frame of assets/crosser/ drawn for the critter posed on row " +
        `${ROW_BAYS} (specs/assets.md)`,
      `${crosser.length} crosser frames drawn, none of them attributable to it`,
    );
  }
  assertGreaterThanOrEqual(
    critter.top + HUD_OVERLAP_MAX,
    HUD_H,
    `the top edge of the critter's own draw, nearest the centre the game ` +
      `reports for it — the HUD bar's ${HUD_H} units are above the strait ` +
      `(specs/strait.md)`,
  );
});
