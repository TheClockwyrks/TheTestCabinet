// Wireworm — instrumentation/overlay: the debug overlay reports the game, and
// watching it leaves the game as it is.
//
// specs/instrumentation.md "Diagnostics" fixes what the overlay shows: the
// current `screen` and `phase`; the score, the lives and the level; how many
// nodes stand on the board; for each worm, its id, its length, its head tile,
// its two headings and its diving flag; for each foe, its id, its kind and its
// position; the cursor's position; and how many bolts are in flight. Under this
// engine the panel is the build's own — "The overlay is part of the runtime layer
// you write. It draws the registered sources, it is shown and hidden by the
// backtick key as `specs/controls.md` states, it is off when the game starts, and
// it reads the game without changing it."
//
// HOW THE LINES ARE READ. The overlay is drawn over the game, through the same
// context every other rendering check reads, so the text a steady frame draws
// WITHOUT the overlay is collected first and the text a frame draws WITH it
// second; the difference is the overlay's own lines.
//
// HOW A VALUE IS RECOGNISED. Every figure below is checked as a whole run of
// digits rather than as a substring, so a `17` on the panel is not answered by
// the `7` inside some other number, and the board is posed so that no two of the
// values asserted share a figure. A run grouped in threes is read as the one
// figure it spells, since the panel reports a figure and draws it however it
// likes. Two of them cannot be made unique — a bolt
// count and an entity id are both small integers — and those are the weakest
// readings here. HOW each value is drawn is the build's: specs/overview.md fixes
// no palette, no typeface and no layout, so the two flags that are not numbers
// are accepted in any of the forms a build would honestly draw them in.
//
// THE BOARD IS POSED AND THEN PAUSED. specs/ui.md freezes the board behind the
// pause menu — "no worm steps, no foe moves, no bolt travels, no phase timer
// runs" — which is what makes "the snapshot is identical before and after" a
// reading about the OVERLAY rather than about the two frames of play that ran
// underneath it. A bolt in flight cannot be held any other way, and the overlay
// must report the bolts in flight.
//
// PURITY is then read straight off the snapshot: identical across the toggle
// apart from `simTime`, which specs/instrumentation.md accumulates from every
// update's delta whatever the screen, and which must therefore advance by exactly
// the two frames the toggle and the reading drove, and no more.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertDeepEqual, fail } from "../assert";
import {
  captureStill,
  createHarness,
  drawnText,
  poseFoe,
  poseWorm,
  seconds,
  startPlaying,
  toggleOverlay,
  type Harness,
} from "../harness";

/** The run posed: three figures no other value on this board carries. */
const SCORE = 4271;
const LIVES = 14;
const LEVEL = 12;

/** The field posed: seventeen nodes along one row, so the count is `17`. */
const NODE_COUNT = 17;
const NODE_C = 2;
const NODE_R = 15;

/** The worm posed: six segments, head on `(23, 9)`, both headings reversed. */
const WORM_LENGTH = 6;
const WORM_C = 23;
const WORM_R = 9;

/** The foe posed: a corruptor, whose centre is `(176, 192)` on tile `(5, 3)`. */
const FOE_C = 5;
const FOE_R = 3;
const FOE_X = 176;
const FOE_Y = 192;

/** The cursor's posed centre, inside the band specs/board.md fixes. */
const CURSOR_X = 656;
const CURSOR_Y = 688;

/** The bolts posed, at centres whose figures collide with nothing above. */
const BOLTS: ReadonlyArray<readonly [number, number]> = [
  [100, 300],
  [200, 400],
  [300, 500],
];

/** How many frames run between the two snapshots: the toggle's, and the reading's. */
const TOGGLE_FRAMES = 2;

/**
 * The two facts that are not numbers, and the forms a build may draw them in.
 *
 * The worm is posed heading left and up with its diving flag set, and
 * specs/instrumentation.md fixes no spelling for either fact: a heading of `-1`
 * is honestly written as a signed number, as an arrow, as a word, or as the
 * initial of a direction — `dh -1`, `←`, `left`, `L`, `LU` are all the same
 * fact — and a diving flag is written as its own name, as an arrow, or as a
 * boolean. So each pattern accepts every one of those forms, and the same pair
 * is read by the `none`, `simple-2d` and `structured-2d` suites, so the one
 * requirement is decided the same way on all three engines.
 */
const HEADING_FORMS = /-1|←|↑|◀|▲|\bleft\b|\bup\b|\bl[ud]?\b|\bu[lr]?\b/i;
const DIVING_FORMS = /div|↓|▼|▽|\btrue\b|\byes\b|\bon\b/i;

/** The lines `after` drew beyond `before`, as a multiset difference. */
function newLines(
  before: readonly string[],
  after: readonly string[],
): string[] {
  const counts = new Map<string, number>();
  for (const line of before) counts.set(line, (counts.get(line) ?? 0) + 1);
  return after.filter((line) => {
    const held = counts.get(line) ?? 0;
    if (held > 0) {
      counts.set(line, held - 1);
      return false;
    }
    return true;
  });
}

/** The separators a build may draw between the digit triples of a figure. */
const GROUP = "[,'\\u00A0\\u202F\\u2009]";

/** One drawn figure: digits grouped in threes, or a plain run of digits. */
const FIGURE = new RegExp(`\\d{1,3}(?:${GROUP}\\d{3})+|\\d+`, "g");

/**
 * Every maximal run of digits the lines carry, with any grouping taken out.
 *
 * specs/instrumentation.md fixes the FIGURE a source reports and leaves the
 * drawing of it to the build, so a panel that groups its thousands — `4,271`,
 * `4'271`, `4 271` written with a non-breaking or a thin space — carries the one
 * figure `4271` and reads as it. An ASCII space is not a grouping separator: the
 * panel's lines are read as the build drew them, and a line reading `40 130`
 * drew the two figures `40` and `130`, not `40130`. Nor is the decimal point, so
 * a line drawing `1.5` still reads out `1` and `5` rather than one figure.
 */
function digitRuns(lines: readonly string[]): string[] {
  return lines.flatMap(
    (line) =>
      line
        .match(FIGURE)
        ?.map((run) => run.replace(new RegExp(GROUP, "g"), "")) ?? [],
  );
}

/** Some line carries `value` as a whole figure; fails naming what was wanted. */
function assertFigure(
  lines: readonly string[],
  value: number,
  what: string,
): void {
  if (!digitRuns(lines).includes(String(value))) {
    fail(`an overlay line carrying ${what} (${String(value)})`, lines);
  }
}

/** Some line matches `pattern`; fails naming what was wanted. */
function assertForm(
  lines: readonly string[],
  pattern: RegExp,
  what: string,
): void {
  if (!lines.some((line) => pattern.test(line))) {
    fail(`an overlay line carrying ${what}`, lines);
  }
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws every registered value and changes nothing in the game", async () => {
  await startPlaying(h);

  await h.debug.setScore(SCORE);
  await h.debug.setLives(LIVES);
  await h.debug.setLevel(LEVEL);
  await h.debug.setCursor(CURSOR_X, CURSOR_Y);

  for (let i = 0; i < NODE_COUNT; i += 1) {
    await h.debug.setNode(NODE_C + i, NODE_R, 0);
  }

  const wormId = await poseWorm(h, {
    c: WORM_C,
    r: WORM_R,
    length: WORM_LENGTH,
    dh: -1,
    dv: -1,
    diving: true,
    stepping: false,
  });

  const foeId = await poseFoe(h, "corruptor", FOE_C, FOE_R, {
    mind: false,
    travel: false,
  });

  for (const [x, y] of BOLTS) await h.debug.addBolt(x, y);

  // Frozen behind the pause menu, so what changes across the toggle is the
  // overlay and nothing else (specs/ui.md).
  await h.debug.setScreen("paused");

  // A steady frame without the overlay, for the baseline text — the overlay is
  // off when the game starts and nothing has toggled it yet.
  const baseline = drawnText(await h.frameCalls());
  const before = await h.snapshot();

  // …then the toggle, and the frame that draws the panel it opened.
  await toggleOverlay(h);
  const overlay = newLines(baseline, drawnText(await h.frameCalls()));
  // The overlay drawn over the posed board.
  await captureStill(h, "overlay");
  const after = await h.snapshot();

  // ---- The values specs/instrumentation.md names --------------------------

  assertForm(overlay, /paused/i, "the current screen, 'paused'");
  assertForm(overlay, /active/i, "the current phase, 'active'");

  assertFigure(overlay, SCORE, "the score");
  assertFigure(overlay, LIVES, "the lives");
  assertFigure(overlay, LEVEL, "the level");

  assertFigure(overlay, NODE_COUNT, "how many nodes stand on the board");

  assertFigure(overlay, wormId, "the worm's id");
  assertFigure(overlay, WORM_LENGTH, "the worm's length");
  assertFigure(overlay, WORM_C, "the column of the worm's head tile");
  assertFigure(overlay, WORM_R, "the row of the worm's head tile");
  assertForm(overlay, HEADING_FORMS, "the worm's headings");
  assertForm(overlay, DIVING_FORMS, "the worm's diving flag");

  assertFigure(overlay, foeId, "the foe's id");
  assertForm(overlay, /corruptor/i, "the foe's kind");
  assertFigure(overlay, FOE_X, "the x of the foe's position");
  assertFigure(overlay, FOE_Y, "the y of the foe's position");

  assertFigure(overlay, CURSOR_X, "the x of the cursor's position");
  assertFigure(overlay, CURSOR_Y, "the y of the cursor's position");

  assertFigure(overlay, BOLTS.length, "how many bolts are in flight");

  // ---- And the game is exactly as it was ----------------------------------

  assertDeepEqual(
    { ...after, simTime: 0 },
    { ...before, simTime: 0 },
    "every diagnostic source is a pure read, so watching the overlay leaves " +
      "the game as it is (specs/instrumentation.md)",
  );
  assertCloseTo(
    after.simTime - before.simTime,
    seconds(TOGGLE_FRAMES),
    6,
    `simTime advances by exactly the ${TOGGLE_FRAMES} frames the toggle and ` +
      `the reading after it drove, and nothing more ` +
      `(specs/instrumentation.md)`,
  );
});
