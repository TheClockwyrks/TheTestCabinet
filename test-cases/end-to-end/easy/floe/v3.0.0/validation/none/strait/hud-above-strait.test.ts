// strait/hud-above-strait — the HUD bar is the strip above the strait, and the
// two regions do not trade places.
//
// `specs/strait.md` divides the stage into exactly two stacked regions: the HUD
// bar over `y` in `[0, HUD_H]` (`[0, 80]`), carrying "the readouts `specs/ui.md`
// fixes" and where "no critter, bear, vehicle, or floe is drawn", and the strait
// below it over `[STRAIT_TOP, STRAIT_TOP + STRAIT_H]` (`[80, 720]`), carrying
// "all play". `specs/ui.md` says the same from the other side: "Nothing drawn on
// the strait is drawn inside the HUD bar."
//
// SO THE POINT HAS TWO HALVES AND BOTH ARE READ, in the one direction the item
// states: the readouts are inside the bar, and the strait's bodies are not.
//
// HOW "A READOUT IS INSIDE THE BAR" IS READ, AND WHAT IS DELIBERATELY NOT READ.
// `specs/ui.md` leaves the HUD's "arrangement and styling" to the build, and two
// of its five readouts are things a build may legitimately draw without text at
// all — the lives as a row of marks, the bays as "one mark per bay", and a timer
// as a bar. So this check reads the two readouts that cannot be anything but
// text: the LEVEL readout, whose copy `HUD_LEVEL_LABEL` the specification fixes,
// and the SCORE, which is a running number. Each is posed at a value that appears
// nowhere else on the screen, so the run of text carrying it is found by what it
// says rather than by where it is, and the reading is the anchor that run was
// drawn at, mapped through whatever transform was in force.
//
// HOW "NOTHING OF THE STRAIT IS IN THE BAR" IS READ. `specs/assets.md` makes the
// critter, the bear, the three vehicles and the two floes the only things drawn
// from seeded art, and every one of them is a body of the strait. So the reading
// is every `drawImage` the frame issued whose source is one of those seven
// folders: the destination box each was drawn into must lie wholly at or below
// `HUD_H`. Everything else the build draws is its own — the bands, the bays, the
// bar itself — and nothing here constrains it.
//
// THE CRITTER IS READ APART FROM THE OTHER SIX FOLDERS, because `specs/assets.md`
// says a lives icon in the HUD "may reuse one of these frames" — a crosser frame
// drawn inside the bar is a permitted readout, not the critter, and failing a
// build for it would fail a build that did exactly what the specification allows.
// What is held to the boundary instead is the critter's OWN draw, taken as the
// crosser frame nearest the centre the game reports for it. A build that drew the
// critter from a strait `y` rather than a stage one puts that draw eighty units
// up, inside the bar, and a lives icon elsewhere in the bar is hundreds of units
// further from the critter's reported centre than the misplaced draw is.
//
// THE SCENARIO POSES THE FOUR BODIES AT THE TOP OF THE STRAIT, each on the
// topmost row its own rules allow it: the critter in a bay of row `1`, a bear on
// row `2` (`specs/hunter.md` keeps a bear off the far shore), a floe on the top
// water row and a vehicle on the top ice row. A build that drew any of them from
// a strait `y` rather than a stage one — the single missing `STRAIT_TOP` — puts
// them eighty units up, inside the bar, and only the topmost bodies show it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertBetween,
  assertDeepEqual,
  assertGreaterThanOrEqual,
  assertLength,
  fail,
} from "../assert";
import {
  HUD_H,
  HUD_LEVEL_LABEL,
  ICE_TOP,
  ROW_BAYS,
  WATER_TOP,
} from "../constants";
import {
  blitsOfFrame,
  captureStill,
  createHarness,
  drawnTextRuns,
  poseBear,
  poseLane,
  startCrossing,
  type Blit,
  type Harness,
} from "../harness";

/**
 * The score this scenario poses.
 *
 * A run of digits that appears nowhere else the HUD can put one: not `3` lives,
 * not level `1` of `8`, and not the crossing timer, which `specs/progression.md`
 * starts at `30` seconds for level `1`. So the one text run containing it is the
 * score readout, whatever else the build wrote around it.
 */
const POSED_SCORE = 12345;

/**
 * The separators a build may set between the score's digit triples.
 *
 * `Number.prototype.toLocaleString` groups by default, so a build that reaches for
 * it draws a score of `12345` as `12,345`, and another locale's grouping gives
 * `12'345` or `12\u202F345`. Every one of those draws the one figure, and
 * specs/ui.md — which leaves the HUD's "arrangement and styling" to the build —
 * fixes none of them, so the score's run is looked for under each.
 *
 * THE ASCII SPACE IS DELIBERATELY NOT ONE OF THEM. It is what separates two
 * readouts a build set in the same run, so accepting it would take the `40` and
 * the `130` of "SCORE 40  TIME 130" for the single figure `40130`. `.` is left out
 * for its own reason: it is the decimal point.
 */
const GROUPS: readonly string[] = [",", "'", "\u00A0", "\u202F", "\u2009"];

/** Every setting of `figure` a build may have drawn: plain, and grouped by each of {@link GROUPS}. */
function settings(figure: number): string[] {
  const digits = String(figure);
  return [
    digits,
    ...GROUPS.map((group) => digits.replace(/\B(?=(\d{3})+$)/g, group)),
  ];
}

/** Whether a run of text carries the score, under any of {@link settings}. */
function carriesScore(text: string): boolean {
  return settings(POSED_SCORE).some((setting) => text.includes(setting));
}

/**
 * How far below `HUD_H` a body's drawn box may begin, in stage units.
 *
 * `specs/strait.md` puts the boundary at exactly `HUD_H`, and the topmost body
 * this scenario poses is centred on row `1`, whose own top edge is a whole tile
 * below it, so a conforming build has thirty-two units of clearance and this
 * bound is not a judgement call. It is `0.5` rather than `0` for one reason only:
 * a build is free to draw a body scaled by a fraction of a unit — a hop's bounce,
 * a bear's lunge — and a box half a unit high into the bar is not "drawn in the
 * HUD bar" by any reading, while eighty units into it is.
 */
const HUD_OVERLAP_MAX = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the readouts inside the HUD bar and none of the strait's bodies there", async () => {
  await startCrossing(h);
  await h.debug.setScore(POSED_SCORE);

  // The four bodies, each as high up the strait as its own rules put it.
  await poseLane(h, ICE_TOP, "plow", [10]);
  await poseLane(h, WATER_TOP, "raft4", [24]);
  await h.debug.setCritterTile(19, ROW_BAYS);
  await poseBear(h, 30, WATER_TOP, {
    sense: false,
    routing: false,
    travel: false,
  });

  await h.step();
  await captureStill(h, "hud");
  const reported = (await h.snapshot()).critter;

  // The readouts: the run of text carrying each, and the anchor it was drawn
  // at. The LOGICAL runs, so a readout letter-spaced a glyph per `fillText` is
  // found by what it spells; a merged run keeps its glyphs' shared baseline.
  const calls = await h.frameCalls();
  const runs = drawnTextRuns(calls);
  const level = runs.filter((run) =>
    run.text.toUpperCase().includes(HUD_LEVEL_LABEL),
  );
  const score = runs.filter((run) => carriesScore(run.text));
  assertLength(
    level,
    1,
    `the runs of text carrying the ${HUD_LEVEL_LABEL} readout (specs/ui.md)`,
  );
  assertLength(
    score,
    1,
    `the runs of text carrying the score ${POSED_SCORE} (specs/ui.md)`,
  );
  assertBetween(
    level[0].y,
    0,
    HUD_H,
    `the ${HUD_LEVEL_LABEL} readout's baseline, inside the HUD bar (specs/strait.md)`,
  );
  assertBetween(
    score[0].y,
    0,
    HUD_H,
    "the score readout's baseline, inside the HUD bar (specs/strait.md)",
  );

  // The bodies: every draw from the seeded art, and the top of the box it went
  // into. `blitsOfFrame` runs a frame of its own, so it is called after the two
  // readings above rather than beside them.
  const blits = (await blitsOfFrame(h)).filter(
    (blit) => blit.matches.length > 0,
  );

  // The bear, the plow and the raft this scenario posed: three bodies drawn from
  // a folder no HUD readout may borrow. The situation, read before the verdict.
  const strait = blits.filter((blit) =>
    blit.matches.every((frame) => frame.sheet !== "crosser"),
  );
  assertGreaterThanOrEqual(
    strait.length,
    3,
    "the bear, the vehicle and the floe this scenario posed, each drawn from " +
      "its seeded folder (specs/assets.md)",
  );
  for (const blit of strait) {
    const sheet = blit.matches[0].sheet;
    assertGreaterThanOrEqual(
      blit.y - blit.height / 2 + HUD_OVERLAP_MAX,
      HUD_H,
      `the top edge of the ${sheet} drawn at (${Math.round(blit.x)}, ${Math.round(blit.y)}), which the HUD bar's ${HUD_H} units are above (specs/strait.md)`,
    );
  }

  // The critter's own draw: the crosser frame nearest the centre the game reports
  // for it, which a lives icon elsewhere in the bar cannot be.
  const crosser = blits.filter((blit) =>
    blit.matches.some((frame) => frame.sheet === "crosser"),
  );
  const away = (blit: Blit): number =>
    Math.hypot(blit.x - reported.x, blit.y - reported.y);
  const critter = crosser.reduce<Blit | null>(
    (nearest, blit) =>
      nearest === null || away(blit) < away(nearest) ? blit : nearest,
    null,
  );
  if (critter === null) {
    fail(
      `a frame of assets/crosser/ drawn for the critter posed on row ` +
        `${ROW_BAYS} (specs/assets.md)`,
      `${crosser.length} crosser frames drawn, none of them attributable to it`,
    );
  }
  assertGreaterThanOrEqual(
    critter.y - critter.height / 2 + HUD_OVERLAP_MAX,
    HUD_H,
    `the top edge of the critter's own draw, nearest the centre the game ` +
      `reports for it — the HUD bar's ${HUD_H} units are above the strait ` +
      `(specs/strait.md)`,
  );

  // Nothing the page threw or logged as an error while this harness drove it.
  assertDeepEqual(h.pageErrors, []);
});
