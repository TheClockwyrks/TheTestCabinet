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
// no palette, no typeface and no layout, so the worm's two headings and its
// diving flag, which are not figures, are read as a DEPENDENCE: the panel drawn
// after one of them is moved through the surface differs from the panel drawn
// before, whatever spelling the build chose.
//
// A DEPENDENCE IS READ AGAINST A CONTROL PAIR. specs/instrumentation.md fixes
// what the overlay shows AT LEAST, so a build may register more, and a source
// such as `simTime`, which accumulates every update's delta whatever the screen,
// a frame count or a frame time moves with the board frozen: its line differs
// between any two readings whatever was moved, and a difference alone proves
// nothing. So before a value is moved the panel is read twice with nothing
// moved, a second of the driven clock apart, and the lines that differed are
// RESTLESS; a value answers only through a line that changed when it was moved
// and is not one of those. A line is known by its text with every run of digits
// masked and its rank among the lines that mask the same, rather than by its
// index or by its text: a restless line's text is new at every reading, and an
// index would rename every line after a mark that comes and goes. It is
// COMPARED by its full text.
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
  drawnTextForms,
  poseFoe,
  poseWorm,
  seconds,
  startPlaying,
  TICK_HZ,
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
 * How many frames apart the two CONTROL readings of the panel are taken: one
 * second of the driven clock.
 *
 * A line that moves on its own moves at its own rate. A frame time or a frame
 * count changes every frame, and two readings one frame apart catch it; a clock
 * drawn to whole seconds ticks once a second, and two readings one frame apart
 * almost never straddle the tick, yet a dependence pair sometimes would. A
 * second of frames holds every such clock to at least one tick, so the control
 * pair names it restless before a dependence can rest on it.
 */
const CONTROL_FRAMES = TICK_HZ;

/** A run of digits, which is what a line's figure is drawn as. */
const DIGITS = /\d+/g;

/**
 * Every line of one reading of the panel, under a name that outlives its figures.
 *
 * The worm's two headings and its diving flag are not figures, and
 * specs/instrumentation.md fixes no spelling for them: a heading of `-1` is
 * honestly written as a signed number, an arrow, a word or an initial, and a
 * flag as its name, an arrow, a boolean, or a mark that is there when it is set
 * and gone when it is not. No list of forms is complete, so each is read as a
 * DEPENDENCE instead: the panel drawn after the value is moved through the
 * surface differs from the panel drawn before it, and a panel that reports the
 * value nowhere draws the same lines twice. The board is frozen and the panel
 * stays up between the two readings, so the value moved is the only thing that
 * changed under them, apart from what the panel moves on its own — which the
 * control pair names first, and which no dependence may rest on. The `none`,
 * `simple-2d` and `structured-2d` suites read the three the same way.
 *
 * A LINE IS NAMED BY ITS MASKED TEXT AND ITS RANK: its text with every run of
 * digits blanked, and how many lines before it in the reading blank to the
 * same. A figure that moves on its own leaves its line's name alone, so the
 * line the control pair found restless is the line a dependence pair finds
 * changed; a panel with two worms tells its two worm lines apart by rank; and a
 * mark that is drawn only while the worm dives is a name present in one reading
 * and absent from the other. Only the name is masked: a line is compared by
 * its FULL text, so a flag written `1` or `0` still changes its line.
 */
function nameLines(lines: readonly string[]): Map<string, string> {
  const ranks = new Map<string, number>();
  const named = new Map<string, string>();
  for (const line of lines) {
    const mask = line.replace(DIGITS, "#");
    const rank = ranks.get(mask) ?? 0;
    ranks.set(mask, rank + 1);
    named.set(`${mask}\u0000${String(rank)}`, line);
  }
  return named;
}

/** The names of every line the two readings disagree on, either way round. */
function changedLines(a: readonly string[], b: readonly string[]): Set<string> {
  const namedA = nameLines(a);
  const namedB = nameLines(b);
  const changed = new Set<string>();
  for (const [name, line] of namedA) {
    if (namedB.get(name) !== line) changed.add(name);
  }
  for (const [name, line] of namedB) {
    if (namedA.get(name) !== line) changed.add(name);
  }
  return changed;
}

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
  // Both as the calls split the panel and as the runs they spell: the figures
  // are held to a boundary on both sides (`drawnTextForms`).
  const baseline = drawnTextForms(await h.frameCalls());
  const before = await h.snapshot();

  // …then the toggle, and the frame that draws the panel it opened.
  await toggleOverlay(h);
  const overlay = newLines(baseline, drawnTextForms(await h.frameCalls()));
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

  assertFigure(overlay, foeId, "the foe's id");
  assertForm(overlay, /corruptor/i, "the foe's kind");
  assertFigure(overlay, FOE_X, "the x of the foe's position");
  assertFigure(overlay, FOE_Y, "the y of the foe's position");

  assertFigure(overlay, CURSOR_X, "the x of the cursor's position");
  assertFigure(overlay, CURSOR_Y, "the y of the cursor's position");

  assertFigure(overlay, BOLTS.length, "how many bolts are in flight");

  // ---- The two headings and the diving flag, as a dependence --------------

  /** The panel's lines on the next frame. */
  const panelNow = async (): Promise<string[]> =>
    newLines(baseline, drawnTextForms(await h.frameCalls()));

  // The control pair: the panel read twice with nothing moved, a second of the
  // driven clock apart. Whatever differs is what the panel moves on its own,
  // and no dependence below may rest on it.
  const still = await panelNow();
  await h.advance(CONTROL_FRAMES - 1);
  const restless = changedLines(still, await panelNow());

  /** One value moved through the surface, and the panel before and after. */
  const answersTo = async (
    move: () => Promise<void>,
    what: string,
  ): Promise<void> => {
    const held = await panelNow();
    await move();
    const moved = await panelNow();
    const answers = [...changedLines(held, moved)].some(
      (name) => !restless.has(name),
    );
    if (!answers) {
      fail(
        `an overlay line that changes when ${what} is moved through the ` +
          `surface and holds still with nothing moved (${String(restless.size)} ` +
          `line(s) moved on their own), so a source reports it ` +
          `(specs/instrumentation.md)`,
        held,
      );
    }
  };

  await answersTo(
    () => h.debug.setWormDiving(wormId, false),
    "the worm's diving flag",
  );
  await answersTo(
    () => h.debug.setWormHeading(wormId, 1),
    "the worm's horizontal heading",
  );
  await answersTo(
    () => h.debug.setWormDescent(wormId, 1),
    "the worm's vertical heading",
  );

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
