// Wireworm — board/hud-above-board: the HUD bar sits above the board, and play
// stays underneath it.
//
// specs/board.md splits the stage into two stacked regions and states the rule
// that separates them outright: the HUD bar is `y` in `[0, HUD_H]` (`[0, 80]`),
// the board is `[80, 720]`, "The HUD bar's three readouts are drawn inside the
// HUD bar. No node, worm segment, foe, or bolt is drawn in it: play is confined
// to the board region beneath it." specs/ui.md says the same of the readouts:
// all three sit "inside the bar's own region as specs/board.md states".
//
// A build that laid the board out from `y = 0` — forgetting `BOARD_Y` — draws
// its top rows through the score, and that is the failure this point exists to
// name. So the scenario poses everything play consists of at ITS TOPMOST LEGAL
// PLACE, row `0`: the row the worm enters along, whose tiles span `y` in
// `[80, 112]`, so a correctly placed sprite ABUTS the bar and never crosses it.
//
// HOW EACH HALF IS READ.
//
//   The readouts. Two of the three are addressable in any build, because the
//   specification fixes their content: `HUD_LEVEL_LABEL` (`LEVEL`) is the one
//   piece of HUD copy specs/ui.md names, and the score is "the running score, as
//   digits", so a distinctive posed score appears as its own digits in some run
//   of text however the build groups or pads them. Each run's box is placed in
//   logical units from the transform, the font size and the baseline the context
//   held at the call, and must lie inside `[0, HUD_H]`. The lives readout is not
//   read here: specs/ui.md lets it be "a row of icons", which carries no text at
//   all, so there is nothing every build would draw for it to hold.
//
//   Play. Every node, worm segment and foe is drawn from the seeded sprite art
//   (specs/overview.md's hard requirement, specs/assets.md's contract), so the
//   frame's `drawImage` boxes carry those entities, placed in logical units. But
//   they are not the only sprites a frame draws: specs/ui.md lets the lives
//   readout be "a row of icons" and welcomes "a further readout of your own" on
//   the bar, so a build whose bar is drawn from art of its own puts sprites of
//   its own inside `[0, HUD_H]` and is entitled to. THE PLAY DRAWS ARE THEREFORE
//   PICKED OUT BY MOVING PLAY DOWN THE BOARD AND SEEING WHAT MOVES WITH IT: two
//   boards carry THE SAME POPULATION IN DIFFERENT PLACES — the same nodes at the
//   same charges, the same worm at the same length, the same foe — one on the
//   entry row right under the bar, the other `MID_ROW - TOP_ROW` rows further
//   down. An entity drawn where the board puts it is therefore drawn on the
//   second board at exactly the same place PLUS that many tiles, and a draw of
//   the packed board's that has such a twin is one of ITS entities. Each of
//   those must have its top edge at `BOARD_Y` or below.
//
//   Reading the twin's DISPLACEMENT rather than merely its absence is what keeps
//   the build's own bar out of it. A readout of its own that tracks the board —
//   a field map, a row indicator, anything drawn from what is standing — does
//   move between the two frames, but it moves by whatever its own scale makes of
//   a row, never by a row of the board; only what is drawn on the board moves by
//   the board's own rows. The structured-2d and none projects read the same
//   requirement over the bar's pixels instead.
//
// THE BOLT IS READ AS "GONE MEANS GONE" RATHER THAN AT THE BOUNDARY, and that is
// deliberate. specs/cursor.md keeps a bolt in flight until its CENTRE passes
// `BOARD_Y`, and fixes no drawn extent for it, so a bolt drawn with any height at
// all can reach a little above `y = 80` in its last frames; a check at the
// boundary would be measuring a figure no specification states. What IS
// unambiguous is that once the bolt has left the board nothing of it is drawn
// anywhere, so the third check climbs one past the top and holds the bar in its
// column against the same bar before the bolt existed.

import { afterEach, beforeEach, it } from "vitest";
import {
  BOARD_Y,
  BOLT_SPEED,
  HUD_H,
  HUD_LEVEL_LABEL,
  TILE,
  tileCX,
  tileCY,
} from "../constants";
import {
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  drawFrame,
  drawnImages,
  drawnTextSpanForms,
  poseBolt,
  poseFoe,
  poseWorm,
  sampleColor,
  startPlaying,
  ticksFor,
  type DrawCall,
  type DrawnImage,
  type Harness,
  type TextSpan,
} from "../harness";

/**
 * The score the HUD is posed with: six digits, none of them a figure anything
 * else on the bar shows, so the run of text carrying them is unmistakably the
 * score readout rather than the level or the lives.
 */
const POSED_SCORE = 431295;

/** The level and the lives posed beside it, both well inside their own ranges. */
const POSED_LEVEL = 7;
const POSED_LIVES = 3;

/**
 * The row each of the two boards holds its population on: the topmost tile row
 * the board has, pressed right up against the bar, and halfway down it.
 */
const TOP_ROW = 0;
const MID_ROW = 8;

/**
 * How far the same entity's draw moves down between the two boards, in logical
 * units: the rows between them, in the board's own tiles (specs/board.md).
 */
const ROW_DROP = (MID_ROW - TOP_ROW) * TILE;

/**
 * How far a draw may sit from where its twin puts it and still be that twin, in
 * logical units.
 *
 * The two boards are the same build on the same frame of the same run, drawing
 * the same population, so this is float noise rather than room a check depends
 * on. It is far short of a tile, so no draw can be mistaken for the twin of one
 * a row away.
 */
const BOX_SLACK = 0.5;

/**
 * How far a sprite's top edge may sit above `BOARD_Y`, in logical units.
 *
 * A sprite filling its tile on row `0` has its top edge exactly on `BOARD_Y`
 * (`80`), because specs/board.md puts that tile at `y` in `[80, 112]`. So this
 * is rounding room for mapping a destination box back through the engine's fit,
 * not licence to paint into the bar.
 */
const EDGE_EPSILON = 0.5;

/**
 * How far a sampled bar pixel may move once a bolt has left the board, in RGB
 * distance on the 0–441 scale.
 *
 * The reading is a CHANGE in the same points of the bar rather than a colour, so
 * no palette is assumed. 25 is about a twentieth of the scale — far below
 * anything a bolt a player can follow up its column would measure, and far above
 * whatever a build's own bar does over the 0.08 s that separates the two
 * readings.
 */
const BAR_QUIET_MAX = 25;

/**
 * The tile the bolt is posed on, and the column of the bar its leak is read in.
 *
 * Mid-board, so the strip sampled below is well clear of both ends of the bar.
 */
const BOLT_COL = 15;
const BOLT_ROW = 1;

/**
 * Frames to run after posing the bolt: long enough that a bolt travelling at
 * `BOLT_SPEED` has passed `BOARD_Y` and gone, short enough that one the build
 * kept is still over the bar rather than off the canvas.
 *
 * From `tileCY(1)` (`128`) the centre reaches `BOARD_Y` (`80`) after `48 /
 * BOLT_SPEED` = `0.053` s; `0.08` s puts a surviving bolt's centre at `56`,
 * squarely inside the bar.
 */
const BOLT_READ_TICKS = ticksFor(0.08);

/** Where in the bolt's column the bar is sampled, in logical units. */
const BAR_SAMPLE_DX = [-16, -8, 0, 8, 16] as const;
const BAR_SAMPLE_Y = [8, 24, 40, 56, 72] as const;

/**
 * How far a draw may sit from the run it belongs to and still be read as one of
 * its glyphs, in logical units.
 *
 * The harness's merge rule joins draws within three quarters of a device pixel
 * of one baseline and lets a draw start half a pixel inside the run before it,
 * so at the harness's one-unit-per-pixel shape one unit is rounding room and
 * never a rule of its own.
 */
const MEMBER_SLACK = 1;

/** One text draw a frame made, boxed in logical units. */
interface TextBox {
  text: string;
  /** The baseline and the horizontal extent, as `drawnTextSpans` places them. */
  y: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

let h: Harness;

/** The second board the play half opens, disposed with the first. */
let extra: Harness[] = [];

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  for (const board of extra) board.dispose();
  extra = [];
  h?.dispose();
});

/** The pixel size in a CSS font string, or the canvas default of 10. */
function fontPx(font: string): number {
  const match = /(\d+(?:\.\d+)?)px/.exec(font);
  return match === null ? 10 : Number(match[1]);
}

/**
 * Every text draw `calls` made, boxed vertically in logical units.
 *
 * A build anchors its text through whatever transform it likes and sets its own
 * font and baseline, so the whole call list is walked to know both at each draw
 * (`save`/`restore` honoured), and the draw is given a generous em box about its
 * baseline — erring toward crossing the boundary, never away from it. Each box
 * carries its baseline and horizontal extent as well, which is how it is
 * attributed to the run it is part of.
 */
function textBoxes(calls: readonly DrawCall[]): TextBox[] {
  const view = h.engine.viewport();
  let font = "10px sans-serif";
  let baseline = "alphabetic";
  const saved: { font: string; baseline: string }[] = [];
  const boxes: TextBox[] = [];

  for (const call of calls) {
    if (call.kind === "set") {
      if (call.property === "font" && typeof call.value === "string") {
        font = call.value;
      }
      if (call.property === "textBaseline" && typeof call.value === "string") {
        baseline = call.value;
      }
      continue;
    }
    if (call.method === "save") {
      saved.push({ font, baseline });
      continue;
    }
    if (call.method === "restore") {
      const popped = saved.pop();
      if (popped !== undefined) ({ font, baseline } = popped);
      continue;
    }
    if (call.text === undefined) continue;
    const [text, ax, ay] = call.args;
    if (typeof text !== "string" || typeof ax !== "number") continue;
    if (typeof ay !== "number") continue;

    // The transform the context held at the call, stamped beside it by the
    // harness's recorder (`harness.ts`) — the anchor a `fillText` names is only
    // where the draw landed once that transform is applied — and the width the
    // context measured at it, under the alignment in force, which is what
    // places its glyphs about that anchor.
    const m = call.transform;
    if (m === undefined) continue;
    const { width, textAlign } = call.text;
    const deviceX = m.a * ax + m.c * ay + m.e;
    const deviceY = m.b * ax + m.d * ay + m.f;
    const x = (deviceX - view.offsetX) / view.scale;
    const y = (deviceY - view.offsetY) / view.scale;
    const w = (width * Math.hypot(m.a, m.b)) / view.scale;
    const before =
      textAlign === "center"
        ? w / 2
        : textAlign === "right" || textAlign === "end"
          ? w
          : 0;
    const left = x - before;
    const right = x - before + w;
    const size = (fontPx(font) * Math.hypot(m.c, m.d)) / view.scale;
    let top: number;
    let bottom: number;
    switch (baseline) {
      case "top":
      case "hanging":
        top = y;
        bottom = y + size;
        break;
      case "middle":
        top = y - size / 2;
        bottom = y + size / 2;
        break;
      case "bottom":
      case "ideographic":
        top = y - size;
        bottom = y;
        break;
      default:
        // alphabetic: a full ascent above the baseline, a descent below.
        top = y - 0.8 * size;
        bottom = y + 0.25 * size;
    }
    boxes.push({ text, y, left, right, top, bottom });
  }
  return boxes;
}

/** Whether `box` is one of the draws `span` spells: on its baseline, inside it. */
function partOf(box: TextBox, span: TextSpan): boolean {
  return (
    Math.abs(box.y - span.y) <= MEMBER_SLACK &&
    box.left >= span.left - MEMBER_SLACK &&
    box.right <= span.right + MEMBER_SLACK
  );
}

/**
 * Every box that is part of a span `carries` — the draws of a readout, however
 * the build split it.
 *
 * The spans are the frame's calls AND the runs they spell (`drawnTextSpanForms`),
 * so a readout the build letter-spaced a glyph per call is found in the run and
 * its boxes are the glyphs on that run's baseline inside its extent; one drawn in
 * a single call is found in that call, whose box is the whole of its own run.
 */
function boxesOf(
  boxes: TextBox[],
  spans: TextSpan[],
  carries: (text: string) => boolean,
): TextBox[] {
  const carrying = spans.filter((span) => carries(span.text));
  return boxes.filter((box) => carrying.some((span) => partOf(box, span)));
}

/** Whether `text` carries `digits` once everything else is stripped out. */
function showsDigits(text: string, digits: string): boolean {
  return text.replace(/\D/g, "").includes(digits);
}

it("draws the score and the level readouts inside the HUD bar", async () => {
  startPlaying(h);
  h.debug.setScore(POSED_SCORE);
  h.debug.setLives(POSED_LIVES);
  h.debug.setLevel(POSED_LEVEL);

  const drawn = await drawFrame(h);
  const boxes = textBoxes(drawn);
  const spans = drawnTextSpanForms(h, drawn);

  const readouts = [
    {
      name: `the score readout, the digits of ${POSED_SCORE}`,
      found: boxesOf(boxes, spans, (text) =>
        showsDigits(text, String(POSED_SCORE)),
      ),
    },
    {
      name: `the level readout, carrying HUD_LEVEL_LABEL (${HUD_LEVEL_LABEL})`,
      found: boxesOf(boxes, spans, (text) => text.includes(HUD_LEVEL_LABEL)),
    },
  ];

  for (const readout of readouts) {
    assertGreaterThan(
      readout.found.length,
      0,
      `${readout.name} is drawn on the playing screen (specs/ui.md)`,
    );
    for (const box of readout.found) {
      assertGreaterThanOrEqual(
        box.top,
        0,
        `${readout.name}: its top edge inside the HUD bar, y in [0, ${HUD_H}]`,
      );
      assertLessThanOrEqual(
        box.bottom,
        HUD_H,
        `${readout.name}: its bottom edge inside the HUD bar, ` +
          `y in [0, ${HUD_H}]`,
      );
    }
  }
});

/**
 * Pose the same run, and the same population on `row`.
 *
 * Each entity is posed with only the faculty this point needs — being DRAWN — so
 * nothing wanders out of its row between the pose and the frame, and the two
 * boards differ in the row alone.
 */
function poseBoard(board: Harness, row: number): void {
  startPlaying(board);
  board.debug.setScore(POSED_SCORE);
  board.debug.setLives(POSED_LIVES);
  board.debug.setLevel(POSED_LEVEL);

  for (let c = 0; c <= 10; c += 2) board.debug.setNode(c, row, 2);
  const worm = poseWorm(board, 31, row, 10);
  board.debug.setWormStepping(worm, false);
  const glitch = poseFoe(board, "glitch", 36, row);
  board.debug.setFoeMind(glitch, false);
  board.debug.setFoeTravel(glitch, false);
}

/**
 * Whether `moved` is the same picture as `packed`, the same size, drawn `drop`
 * logical units further down the stage.
 */
function twinBelow(
  packed: DrawnImage,
  moved: DrawnImage,
  drop: number,
): boolean {
  return (
    Math.abs(moved.x - packed.x) <= BOX_SLACK &&
    Math.abs(moved.y - (packed.y + drop)) <= BOX_SLACK &&
    Math.abs(moved.w - packed.w) <= BOX_SLACK &&
    Math.abs(moved.h - packed.h) <= BOX_SLACK
  );
}

it("keeps every node, worm segment and foe out of the HUD bar", async () => {
  // Row 0 is the topmost tile row the board has, so `h` is play pressed as far
  // up against the bar as the rules allow; `mid` is the same population halfway
  // down, and the two frames are the same frame of the same run.
  poseBoard(h, TOP_ROW);
  const mid = await createHarness();
  extra.push(mid);
  poseBoard(mid, MID_ROW);

  const packed = drawnImages(h, await drawFrame(h));
  const halfway = drawnImages(mid, await drawFrame(mid));
  captureStill(h, "hud");

  // A draw of the packed board's whose twin the halfway board made ROW_DROP
  // lower is a draw the BOARD placed, and so is one of its entities. Each twin
  // is matched off ONCE, so a build drawing four node sprites where the other
  // board's twin count is one still has three read as play.
  const moved = [...halfway];
  const play = packed.filter((image) => {
    const index = moved.findIndex((other) => twinBelow(image, other, ROW_DROP));
    if (index === -1) return false;
    moved.splice(index, 1);
    return true;
  });

  assertGreaterThan(
    play.length,
    0,
    `sprites the board on row ${TOP_ROW} drew that the same board on row ` +
      `${MID_ROW} drew ${ROW_DROP} logical units lower — the nodes, worm ` +
      "segments and foes are drawn from the seeded sprite art " +
      "(specs/assets.md), so moving them down the board moves their draws " +
      "with them, by the board's own rows",
  );
  for (const image of play) {
    assertGreaterThanOrEqual(
      image.y - image.h / 2,
      BOARD_Y - EDGE_EPSILON,
      `a sprite centred at (${image.x.toFixed(1)}, ${image.y.toFixed(1)}) ` +
        `that the board on row ${MID_ROW} drew ${ROW_DROP} units lower — its ` +
        `top edge, against the board's own top at BOARD_Y (${BOARD_Y})`,
    );
  }
});

it("leaves nothing of a bolt in the HUD bar once it has left the board", async () => {
  startPlaying(h);
  await h.advance(1);

  // The bar in the bolt's own column, before any bolt exists.
  const x = tileCX(BOLT_COL);
  const points = BAR_SAMPLE_DX.flatMap((dx) =>
    BAR_SAMPLE_Y.map((y) => ({ x: x + dx, y })),
  );
  const quiet = points.map((point) => sampleColor(h, point.x, point.y));

  poseBolt(h, BOLT_COL, BOLT_ROW);
  await h.advance(BOLT_READ_TICKS);

  points.forEach((point, index) => {
    assertLessThanOrEqual(
      colorDistance(quiet[index], sampleColor(h, point.x, point.y)),
      BAR_QUIET_MAX,
      `the HUD bar at (${point.x}, ${point.y}), ${BOLT_READ_TICKS} frames ` +
        `after a bolt was posed on tile (${BOLT_COL}, ${BOLT_ROW}) — climbing ` +
        `at BOLT_SPEED (${BOLT_SPEED}), a bolt covers the ` +
        `${tileCY(BOLT_ROW) - BOARD_Y} units from that tile's centre to ` +
        `BOARD_Y (${BOARD_Y}) well inside that, and specs/cursor.md has it ` +
        "gone once its centre passes",
    );
  });
});
