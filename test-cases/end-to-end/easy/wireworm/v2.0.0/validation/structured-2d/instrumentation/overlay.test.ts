// Wireworm — instrumentation/overlay: the debug overlay reports the game, and
// watching it leaves the game exactly as it is.
//
// specs/instrumentation.md, Diagnostics, names what the build registers: "the
// current `screen` and `phase`; the score, the lives, and the level; how many
// nodes stand on the board; for each worm, its id, its length, its head tile,
// its two headings, and its diving flag; for each foe, its id, its kind, and its
// position; the cursor's position; how many bolts are in flight." And it fixes
// the one property the panel must have: "keep every source a pure read, so
// watching the overlay leaves the game exactly as it is."
//
// UNDER THIS ENGINE THE PANEL IS THE ENGINE'S. The build's whole part is to
// register the sources through `world.diagnostics`; the engine owns the panel,
// the backtick key that toggles it, and its read-only-ness. So this point reads
// what the engine drew with them: the overlay's lines land in the frame's text
// draws, and every fact is looked for there.
//
// THE FACTS ARE READ AS THE VALUES THEY ARE, NOT AS A FORMAT. The specification
// names what each line must report and deliberately fixes no spelling for it —
// "Keep each one short enough to read on a line" is the whole of the layout
// requirement — so the board below is posed with values a build cannot render as
// anything but themselves, and each is looked for as a standalone number
// anywhere in the panel. Every posed figure is distinct from every other, so a
// build reporting the node count where the bolt count belongs still fails the
// fact it left out.
//
// TWO FACTS ARE READ EITHER WAY ROUND, BECAUSE THE SPECIFICATION LEAVES THEM
// OPEN. A foe's "position" and "the cursor's position" could honestly be written
// in the logical units the snapshot reports or in the tile those units fall on
// (specs/board.md gives the map both ways), so each is accepted in either
// spelling. A worm's "head tile" is named as a tile and is read as one.
//
// AND TWO ARE READ AS FORMS RATHER THAN AS FIGURES. A worm's "two headings" and
// its "diving flag" are a pair of `+1`/`-1` values and a boolean, and there is
// no spelling of either that the specification fixes — `LU`, `left/up`,
// `dh -1 dv -1` and `←↑` are all honest renderings of the same fact. So the worm
// is posed heading LEFT and UP with its diving flag set, which is the reading
// whose written forms can be enumerated (a `+1` cannot: the digit `1` falls
// inside every other figure on the panel), and each fact is accepted in any of
// the forms {@link HEADING_FORMS} and {@link DIVING_FORMS} list. The `none` and
// `simple-2d` suites read the same two patterns, so the one requirement is
// decided the same way on all three engines.
//
// THE PANEL IS COMPARED AGAINST THE FRAME BEFORE IT, WHICH IS ALSO THE
// OFF-BY-DEFAULT READING. The HUD draws the score, the lives and the level in
// every frame (specs/ui.md), so a fact found somewhere on the canvas is not
// evidence the overlay reported it. What is read here is what the toggle ADDED:
// the lines the frame with the panel up drew that the frame before it did not.
// The engine's own world line and its frame-metrics line are dropped from that,
// since neither is the build's.
//
// AND THE GAME IS UNCHANGED ACROSS THE TOGGLE. The snapshot is compared either
// side of it — the run's every figure, both world gates, the cursor, the fire
// cooldown, and the whole node field, tile for tile and charge for charge — so a
// source that wrote to the state rather than reading it shows up here as a
// changed field. Four entries are held to their COUNT instead of their contents,
// because a frame moves them on their own account and this point is not the one
// that grades that: `simTime`, which "accumulates every update's delta, whatever
// the screen", and the three rosters whose entries travel or step. A source that
// removed a worm, a foe or a bolt still fails; where those entities had got to
// by the next frame is `worm/*` and `foes/*`'s to say.

import { afterEach, beforeEach, it } from "vitest";
import { tileCX, tileCY } from "../../src/constants";
import { assertDeepEqual, assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  drawnText,
  poseBolt,
  poseFoe,
  poseWorm,
  startPlaying,
  tileAtPoint,
  toggleOverlay,
  type Harness,
  type WirewormSnapshot,
} from "../harness";

/** The screen and phase posed, both words the specification's own vocabulary fixes. */
const SCREEN = "playing" as const;
const PHASE = "active" as const;

/** The run's three figures, each a number no other posed figure repeats. */
const SCORE = 271;
const LIVES = 37;
const LEVEL = 11;

/** The node field: 23 nodes along one row. */
const NODE_ROW = 5;
const NODE_FIRST_COL = 8;
const NODE_COUNT = 23;

/**
 * The worm: 14 segments, head on tile (26, 13), heading LEFT and UP with its
 * diving flag set, so its body trails RIGHT along the row to column 39.
 */
const WORM_C = 26;
const WORM_R = 13;
const WORM_LENGTH = 14;
const WORM_DH = -1;
const WORM_DV = -1;

/** The foe: a glitch on tile (34, 3), whose center is (1104, 192). */
const FOE_C = 34;
const FOE_R = 3;

/** The cursor's center, which falls on tile (33, 18). */
const CURSOR_X = 1077;
const CURSOR_Y = 676;

/** The bolts: 17 of them, climbing 17 clear columns from the floor row. */
const BOLT_COUNT = 17;
const BOLT_ROW = 19;

/**
 * The engine's own two lines, which belong to the panel but not to the build.
 *
 * The engine draws a world line and a frame-metrics line of its own around the
 * registered sources (engine docs, diagnostics.md). Dropping them keeps this
 * point reading what WIREWORM registered.
 */
const ENGINE_WORLD_LINE = /^level: .*\s{2}phase: .*\s{2}actors: \d+$/;
const ENGINE_METRICS_LINE = /^frame: /;

/** Whether some line carries `value` as a number of its own. */
function mentions(lines: readonly string[], value: number): boolean {
  const pattern = new RegExp(`(?<![\\d.])${value}(?:\\.0+)?(?!\\d)`);
  return lines.some((line) => pattern.test(line));
}

/**
 * The two facts that are not numbers, and the forms a build may draw them in.
 *
 * A heading of `-1` is honestly written as a signed number, as an arrow, as a
 * word, or as the initial of a direction — `dh -1`, `←`, `left`, `L`, `LU` are
 * all the same fact — and a diving flag is written as its own name, as an arrow,
 * or as a boolean. Each pattern accepts every one of those forms.
 */
const HEADING_FORMS = /-1|←|↑|◀|▲|\bleft\b|\bup\b|\bl[ud]?\b|\bu[lr]?\b/i;
const DIVING_FORMS = /div|↓|▼|▽|\btrue\b|\byes\b|\bon\b/i;

/** Whether some line is drawn in one of the forms `pattern` accepts. */
function drawnAs(lines: readonly string[], pattern: RegExp): boolean {
  return lines.some((line) => pattern.test(line));
}

/** Whether some line carries `text`, ignoring case. */
function says(lines: readonly string[], text: string): boolean {
  const wanted = text.toLowerCase();
  return lines.some((line) => line.toLowerCase().includes(wanted));
}

/**
 * The snapshot with the entries a running frame moves on their own left out:
 * the accumulated simulation time, and the three rosters of things that travel
 * or step. What is left — the run's figures, the gates, the cursor, the fire
 * cooldown, the arcs, and the whole node field — a frame leaves alone on a board
 * posed like this one, so a difference is the panel's doing.
 */
function settled(snapshot: WirewormSnapshot): Record<string, unknown> {
  const { simTime, worms, foes, bolts, ...rest } = snapshot;
  void simTime;
  void worms;
  void foes;
  void bolts;
  return rest;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the facts the specification names and changes nothing", async () => {
  startPlaying(h);
  h.debug.setScreen(SCREEN);
  h.debug.setPhase(PHASE);
  h.debug.setPhaseTimer(0);
  h.debug.setScore(SCORE);
  h.debug.setLives(LIVES);
  h.debug.setLevel(LEVEL);

  for (let i = 0; i < NODE_COUNT; i += 1) {
    h.debug.setNode(NODE_FIRST_COL + i, NODE_ROW, 0);
  }

  // Everything on the board is posed STILL, so the comparison across the toggle
  // reads the panel's effect rather than the game's own motion.
  const worm = poseWorm(h, WORM_C, WORM_R, WORM_LENGTH, WORM_DH, WORM_DV);
  h.debug.setWormDiving(worm, true);
  h.debug.setWormStepping(worm, false);
  h.debug.setWormBody(worm, false);

  const foe = poseFoe(h, "glitch", FOE_C, FOE_R);
  h.debug.setFoeTravel(foe, false);
  h.debug.setFoeMind(foe, false);

  h.debug.setCursor(CURSOR_X, CURSOR_Y);
  for (let i = 0; i < BOLT_COUNT; i += 1) {
    poseBolt(h, tileCX(i), tileCY(BOLT_ROW));
  }

  // One frame with the panel down, and the text it drew.
  h.calls.length = 0;
  await h.advance(1);
  const down = drawnText(h.calls);
  const before = h.snapshot();

  // And one with it up.
  h.calls.length = 0;
  await toggleOverlay(h);
  const up = drawnText(h.calls);
  const after = h.snapshot();
  // Before the assertions, so a failing overlay still leaves the picture of the
  // panel drawn over the posed board.
  captureStill(h, "overlay");

  // What the toggle ADDED, less the engine's own two lines.
  const drawn = new Set(down);
  const panel = up.filter(
    (line) =>
      !drawn.has(line) &&
      !ENGINE_WORLD_LINE.test(line) &&
      !ENGINE_METRICS_LINE.test(line),
  );

  assertTrue(
    panel.length > 0,
    "whether pressing the backtick key drew any text the frame before it did " +
      "not — the overlay is off when the game starts and the key shows it " +
      "(specs/instrumentation.md, Diagnostics)",
  );

  const foeAt = after.foes.find((entry) => entry.id === foe);
  const foeTile = tileAtPoint(foeAt?.x ?? 0, foeAt?.y ?? 0);
  const cursorTile = tileAtPoint(after.cursor.x, after.cursor.y);

  /** One fact the panel must carry, and how it may be written. */
  const facts: readonly { what: string; found: boolean }[] = [
    { what: `the screen, "${SCREEN}"`, found: says(panel, SCREEN) },
    { what: `the phase, "${PHASE}"`, found: says(panel, PHASE) },
    { what: `the score, ${SCORE}`, found: mentions(panel, SCORE) },
    { what: `the lives, ${LIVES}`, found: mentions(panel, LIVES) },
    { what: `the level, ${LEVEL}`, found: mentions(panel, LEVEL) },
    {
      what: `how many nodes stand on the board, ${NODE_COUNT}`,
      found: mentions(panel, NODE_COUNT),
    },
    { what: `the worm's id, ${worm}`, found: mentions(panel, worm) },
    {
      what: `the worm's length, ${WORM_LENGTH} segments`,
      found: mentions(panel, WORM_LENGTH),
    },
    {
      what: `the worm's head tile column, ${WORM_C}`,
      found: mentions(panel, WORM_C),
    },
    {
      what: `the worm's head tile row, ${WORM_R}`,
      found: mentions(panel, WORM_R),
    },
    {
      what:
        `the worm's two headings, posed at dh ${WORM_DH} and dv ${WORM_DV}, ` +
        `in any of the forms ${HEADING_FORMS}`,
      found: drawnAs(panel, HEADING_FORMS),
    },
    {
      what: `the worm's diving flag, posed set, in any of the forms ${DIVING_FORMS}`,
      found: drawnAs(panel, DIVING_FORMS),
    },
    { what: `the foe's id, ${foe}`, found: mentions(panel, foe) },
    { what: `the foe's kind, "glitch"`, found: says(panel, "glitch") },
    {
      what:
        `the foe's position across, either its center x ` +
        `(${foeAt?.x}) or its tile column (${foeTile.c})`,
      found:
        mentions(panel, Math.round(foeAt?.x ?? Number.NaN)) ||
        mentions(panel, foeTile.c),
    },
    {
      what:
        `the foe's position down, either its center y ` +
        `(${foeAt?.y}) or its tile row (${foeTile.r})`,
      found:
        mentions(panel, Math.round(foeAt?.y ?? Number.NaN)) ||
        mentions(panel, foeTile.r),
    },
    {
      what:
        `the cursor's position across, either its center x ` +
        `(${after.cursor.x}) or its tile column (${cursorTile.c})`,
      found:
        mentions(panel, Math.round(after.cursor.x)) ||
        mentions(panel, cursorTile.c),
    },
    {
      what:
        `the cursor's position down, either its center y ` +
        `(${after.cursor.y}) or its tile row (${cursorTile.r})`,
      found:
        mentions(panel, Math.round(after.cursor.y)) ||
        mentions(panel, cursorTile.r),
    },
    {
      what: `how many bolts are in flight, ${BOLT_COUNT}`,
      found: mentions(panel, BOLT_COUNT),
    },
  ];

  for (const fact of facts) {
    assertTrue(
      fact.found,
      `${fact.what}, somewhere in the ${panel.length} line(s) the overlay ` +
        `added: ${JSON.stringify(panel)}`,
    );
  }

  // And watching it left the game exactly as it was.
  assertDeepEqual(
    settled(after),
    settled(before),
    "the snapshot with the panel up, against the same snapshot one frame " +
      "earlier with it down, save simTime and the three rosters — every " +
      "diagnostic source is a pure read (specs/instrumentation.md)",
  );
  assertEqual(
    `${after.worms.length},${after.foes.length},${after.bolts.length}`,
    `${before.worms.length},${before.foes.length},${before.bolts.length}`,
    "the worms, foes and bolts on the board across the toggle — they travel " +
      "and step on their own account, but none of them may appear or vanish " +
      "because the panel was shown",
  );
});
