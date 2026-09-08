// Wireworm — instrumentation/overlay: the debug overlay reports the game, and
// watching it leaves the game as it is.
//
// specs/instrumentation.md "Diagnostics" fixes what the build registers: the
// current `screen` and `phase`; the score, the lives and the level; how many
// nodes stand on the board; for each worm, its id, its length, its head tile, its
// two headings and its diving flag; for each foe, its id, its kind and its
// position; the cursor's position; and how many bolts are in flight. Under this
// engine the panel, the backtick key that toggles it and its read-only-ness are
// the engine's, and registering those values through `InitApi.diagnostics` is the
// whole of the build's part — so what this point decides is that the values were
// registered, and that reading them costs the game nothing.
//
// HOW THE LINES ARE READ. The engine draws the overlay after the game's `render`,
// through the same context every other rendering check reads, so the text a steady
// frame draws WITHOUT the overlay is collected first and the text the toggle's
// frame draws WITH it second; the difference is the overlay's own lines. The
// engine's frame-time line is dropped from that difference, because it is the
// engine's and its figures are wall-clock timings that vary run to run.
//
// HOW A VALUE IS RECOGNISED. Every figure below is checked as a whole run of
// digits rather than as a substring, so a `17` on the panel is not answered by the
// `7` inside some other number, and the board is posed so that no two of the
// values asserted share a figure. A run grouped in threes is read as the one
// figure it spells, since the panel reports a figure and draws it however it
// likes. Two of them cannot be made unique — a bolt count
// and an entity id are both small integers — and those are the weakest readings
// here. HOW each value is drawn is the build's: specs/overview.md fixes no
// palette, no typeface and no layout, and the engine formats a source's value
// itself, so the two flags that are not numbers are accepted in any of the forms a
// build would honestly draw them in.
//
// THE BOARD IS POSED AND THEN PAUSED. specs/ui.md freezes the board behind the
// pause menu — no worm steps, no foe moves, no bolt travels, no phase timer runs —
// which is what makes "the snapshot is identical before and after" a reading about
// the OVERLAY rather than about the half-second of play that ran underneath it. A
// bolt in flight cannot be held any other way, and the overlay must report the
// bolts in flight.
//
// PURITY is then read straight off the snapshot: identical across the toggle apart
// from `simTime`, which specs/instrumentation.md accumulates from every update's
// delta whatever the screen, and which must therefore advance by exactly the
// toggle's one frame and no more.

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

/** The foe posed: a corruptor, whose center is `(176, 192)` on tile `(5, 3)`. */
const FOE_C = 5;
const FOE_R = 3;
const FOE_X = 176;
const FOE_Y = 192;

/** The cursor's posed center, inside the band specs/board.md fixes. */
const CURSOR_X = 656;
const CURSOR_Y = 688;

/** The bolts posed, at centers whose figures collide with nothing above. */
const BOLTS: ReadonlyArray<readonly [number, number]> = [
  [100, 300],
  [200, 400],
  [300, 500],
];

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

/** The engine's own frame-time line, which is not one of the game's sources. */
const ENGINE_METRICS = /^\s*frame\s*:/i;

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

/**
 * One drawn figure: digits grouped in threes, or a plain run of digits.
 *
 * THE GROUPED ALTERNATIVE MAY NOT OPEN INSIDE ANOTHER NUMBER, which is what the
 * lookbehind is for. A separator this panel draws between two figures is a
 * separator a figure may also be grouped with — the foe line spells a position
 * as `176.0,192.0`, and without the guard the grouped form opens on the `0` of
 * `176.0`, swallows `,192` as a digit triple and reports the figure `0192`. The
 * y of that position is then nowhere in the reading, and a build that drew it
 * plainly fails for the comma it put between its two coordinates. Refusing to
 * open where a digit or a decimal point stands leaves `176`, `0`, `192` and `0`,
 * which is what the line spells, while `SCORE 4,271` — where nothing precedes
 * the `4` — still reads as the one figure `4271`.
 */
const FIGURE = new RegExp(
  `(?<![\\d.])\\d{1,3}(?:${GROUP}\\d{3})+(?!\\d)|\\d+`,
  "g",
);

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
 *
 * A SEPARATED RUN IS READ BOTH WAYS, because which of the two it is cannot be
 * told from the line. specs/instrumentation.md has the build report a foe's
 * POSITION, and a build is free to spell that pair `176,192` — the same
 * characters a build grouping a thousand would draw for the single figure
 * `176192`. Nothing on the panel distinguishes them, so both readings are
 * offered: the joined figure and each of its groups. A value the panel really
 * carries is then found however the build set it, and the cost is only that a
 * grouped figure also answers for its own groups, which the posed board keeps
 * harmless by giving no two asserted values a figure in common.
 */
function digitRuns(lines: readonly string[]): string[] {
  return lines.flatMap((line) =>
    (line.match(FIGURE) ?? []).flatMap((run) => {
      const parts = run.split(new RegExp(GROUP, "g"));
      return parts.length > 1 ? [parts.join(""), ...parts] : parts;
    }),
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

afterEach(() => {
  h?.dispose();
});

it("draws every registered value and changes nothing in the game", async () => {
  startPlaying(h);

  h.debug.setScore(SCORE);
  h.debug.setLives(LIVES);
  h.debug.setLevel(LEVEL);
  h.debug.setCursor(CURSOR_X, CURSOR_Y);

  for (let i = 0; i < NODE_COUNT; i += 1)
    h.debug.setNode(NODE_C + i, NODE_R, 0);

  const wormId = poseWorm(h, WORM_C, WORM_R, WORM_LENGTH, -1, -1);
  h.debug.setWormDiving(wormId, true);
  // Every other flag on this board is posed FALSE, so the diving flag is the one
  // value a build could honestly draw as "true" and the reading below cannot be
  // answered by some other boolean.
  h.debug.setWormStepping(wormId, false);
  h.debug.setWormBody(wormId, false);

  const foeId = poseFoe(h, "corruptor", FOE_C, FOE_R);
  h.debug.setFoeMind(foeId, false);
  h.debug.setFoeTravel(foeId, false);

  for (const [x, y] of BOLTS) h.debug.addBolt(x, y);

  // Frozen behind the pause menu, so what changes across the toggle is the
  // overlay and nothing else (specs/ui.md).
  h.debug.setScreen("paused");

  // A steady frame without the overlay, for the baseline text…
  h.calls.length = 0;
  await h.advance(1);
  const baseline = drawnText(h.calls);
  const before = h.snapshot();

  // …then the toggle's frame, with it. `Backquote` is the engine's own key
  // (specs/controls.md), so nothing the game registered answers it.
  h.calls.length = 0;
  await h.tap("Backquote");
  // The overlay drawn over the posed board.
  captureStill(h, "overlay");
  const after = h.snapshot();

  const overlay = newLines(baseline, drawnText(h.calls)).filter(
    (line) => !ENGINE_METRICS.test(line),
  );

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
    seconds(1),
    6,
    "simTime advances by exactly the toggle's one frame, and nothing more " +
      "(specs/instrumentation.md)",
  );
});
