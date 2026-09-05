// instrumentation/overlay — the debug overlay reports the game, and watching it
// leaves the game as it is.
//
// specs/instrumentation.md, Diagnostics, names what the build must register: "at
// least the current `screen` and `phase`, the level, the lives, the score and the
// timer, the critter's tile, center, facing and footing, each bear's id, tile,
// center, facing, swimming flag and target, how many vehicles and floes are on the
// strait, and which bays are filled". Under this engine the registering is the
// whole of the build's part — "Drawing the panel, toggling it, and keeping it
// read-only are the engine's" — and every source is "a pure read, so watching the
// overlay leaves the game as it is".
//
// HOW THE PANEL IS READ. The engine draws the overlay after the game's `render`,
// through the same recorded context as everything else, so the check collects the
// text a steady frame draws WITHOUT the panel and then the text the toggle's frame
// draws WITH it: the difference is the panel's own lines. What the toggle itself
// does is `controls/overlay-backquote`'s point, and that item is
// `engines = ["none"]` because the key and the panel are the engine's here; this
// one reads what the panel says, which is the build's under every engine.
//
// THE STRAIT IS POSED SO EVERY FACT IS A NUMBER NOTHING ELSE ON THE PANEL HAS TO
// PRODUCE, and every one of them is a whole number or a fixed word, so no rounding
// or unit a build might choose can move it: a score of `7250`, a crossing clock of
// exactly `17` s, a critter on tile `(27, 13)` — whose centre is therefore
// `(880, 512)` — facing `left` on solid ice, one bear whose centre is `(304, 320)`
// and whose target is tile `(33, 3)`, three vehicles and two floes. A value is
// looked for as a whole number rather than as a substring, so `7250` is not
// answered by a `72` inside something else.
//
// TWO OF THE FACTS ARE FLAGS RATHER THAN FIGURES, AND THEY ARE READ DIFFERENTLY.
// How a build spells a swimming bear or a filled bay is its own — `swim`, `true`,
// a row of marks — so demanding a spelling would fail a conforming build. What is
// demanded instead is that the panel ANSWERS TO the fact: each is changed on a
// strait where nothing else the panel reports changes with it — a floe is slid
// under the bear, which turns its swimming flag off while leaving its tile, its
// target and the floe count exactly as they were, and a bay is filled, which
// specs/instrumentation.md says "scores nothing and clears nothing" — and the
// panel's text must differ. A panel that reports neither draws the same lines
// twice.
//
// THE ENGINE'S OWN METRICS LINE IS EXCLUDED FROM THAT COMPARISON. The engine draws
// `frame: <mean> / <p95> / <p99> ms` under the registered sources, and it moves
// every frame whatever the game does, so it is dropped before two panels are
// compared; it is the engine's line rather than one of the build's sources.
//
// AND THE GAME IS UNTOUCHED. The snapshot before the toggle and the snapshot after
// it are compared field by field, `simTime` apart — every source is a pure read,
// and `simTime` "adds `TICK_DT` on every tick whatever the screen".

import { afterEach, beforeEach, it } from "vitest";
import { tileCX, tileCY, tileLeft } from "../constants";
import { assertDeepEqual, assertNotEqual, fail } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  drawnText,
  lastBear,
  poseBear,
  poseLane,
  startCrossing,
  toggleOverlay,
  type FloeSnapshot,
  type Harness,
} from "../harness";

/** The run posed under the panel: a level, lives, a score and a crossing clock. */
const LEVEL = 6;
const LIVES = 4;
const SCORE = 7250;
const TIMER = 17;

/** The critter: a tile on the ice band, a facing, and the centre both give it. */
const CRITTER_COL = 27;
const CRITTER_ROW = 13;
const CRITTER_FACING = "left";
const CRITTER_FOOTING = "solid";

/** The bear: a water tile no floe covers, and the tile it is posed hunting. */
const BEAR_COL = 9;
const BEAR_ROW = 7;
const TARGET_COL = 33;
const TARGET_ROW = 3;

/** The three vehicles and the two floes the counts are read from. */
const VEHICLE_ROW = 12;
const VEHICLE_COLS = [4, 10, 16];
const FLOE_ROW = BEAR_ROW;
const FLOE_COLS = [20, 30];

/** The bays posed filled, and the open bay filled to make the panel answer. */
const FILLED_BAYS: readonly number[] = [1, 3];
const FLIPPED_BAY = 0;

/** Where a floe is slid to, so it covers the bear's tile and ends its swim. */
const FLOE_UNDER_BEAR_COL = BEAR_COL - 1;

/** The lines `after` drew beyond `before`, as a multiset difference. */
function newLines(before: string[], after: string[]): string[] {
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

/** The engine's own frame-time line, which moves every frame whatever the game does. */
function withoutMetrics(lines: readonly string[]): string[] {
  return lines.filter((line) => !/^\s*frame:/i.test(line));
}

/** Some line of the panel carries `token`; fails naming the fact it stands for. */
function assertReports(
  lines: readonly string[],
  token: RegExp | string,
  what: string,
): void {
  const holds =
    typeof token === "string"
      ? lines.some((line) => line.toLowerCase().includes(token.toLowerCase()))
      : lines.some((line) => token.test(line));
  if (!holds) fail(`an overlay line carrying ${what}`, lines);
}

/** That whole number, not as a digit inside a longer one. */
function whole(value: number): RegExp {
  return new RegExp(`(?<!\\d)${value}(?!\\d)`);
}

/** The snapshot fields that differ between two readings, `simTime` apart. */
function driftedFields(before: FloeSnapshot, after: FloeSnapshot): string[] {
  const fields = Object.keys(before) as (keyof FloeSnapshot)[];
  return fields
    .filter((field) => field !== "simTime")
    .filter(
      (field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]),
    );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the facts the specification lists and leaves the game as it is", async () => {
  startCrossing(h, LEVEL);
  h.debug.setLives(LIVES);
  h.debug.setScore(SCORE);
  h.debug.setTimer(TIMER);

  h.debug.setCritterTile(CRITTER_COL, CRITTER_ROW);
  h.debug.setCritterFacing(CRITTER_FACING);

  // One bear, held still, so its tile, centre and target are the ones posed. Its
  // sense is off so the target stays where it was put rather than following the
  // critter.
  poseBear(h, BEAR_COL, BEAR_ROW, {
    sense: false,
    routing: false,
    travel: false,
  });
  const bear = lastBear(h.snapshot()).id;
  h.debug.setBearTarget(bear, TARGET_COL, TARGET_ROW);

  poseLane(h, VEHICLE_ROW, "car", VEHICLE_COLS);
  const floes = poseLane(h, FLOE_ROW, "raft3", FLOE_COLS);
  for (const bay of FILLED_BAYS) h.debug.setBay(bay, true);

  // A steady frame with the panel away, for the baseline text…
  const baseline = drawnText(await drawFrame(h));
  const before = h.snapshot();

  // …then the toggle's frame, with it.
  h.calls.length = 0;
  await toggleOverlay(h);
  const panel = newLines(baseline, drawnText(h.calls));
  const after = h.snapshot();
  captureStill(h, "overlay");

  // ---- The facts specs/instrumentation.md lists ----------------------------

  assertReports(panel, "playing", "the current screen, 'playing'");
  assertReports(panel, "crossing", "the current phase, 'crossing'");
  assertReports(panel, whole(LEVEL), `the level, ${LEVEL}`);
  assertReports(panel, whole(LIVES), `the lives, ${LIVES}`);
  assertReports(panel, whole(SCORE), `the score, ${SCORE}`);
  assertReports(panel, whole(TIMER), `the crossing timer, ${TIMER} s`);

  assertReports(
    panel,
    whole(CRITTER_COL),
    `the critter's column, ${CRITTER_COL}`,
  );
  assertReports(panel, whole(CRITTER_ROW), `the critter's row, ${CRITTER_ROW}`);
  assertReports(
    panel,
    whole(tileCX(CRITTER_COL)),
    `the critter's centre x, ${tileCX(CRITTER_COL)}`,
  );
  assertReports(
    panel,
    whole(tileCY(CRITTER_ROW)),
    `the critter's centre y, ${tileCY(CRITTER_ROW)}`,
  );
  assertReports(
    panel,
    CRITTER_FACING,
    `the critter's facing, '${CRITTER_FACING}'`,
  );
  assertReports(
    panel,
    CRITTER_FOOTING,
    `the critter's footing, '${CRITTER_FOOTING}'`,
  );

  assertReports(panel, whole(bear), `the bear's id, ${bear}`);
  assertReports(panel, whole(BEAR_COL), `the bear's column, ${BEAR_COL}`);
  assertReports(panel, whole(BEAR_ROW), `the bear's row, ${BEAR_ROW}`);
  assertReports(
    panel,
    whole(tileCX(BEAR_COL)),
    `the bear's centre x, ${tileCX(BEAR_COL)}`,
  );
  assertReports(
    panel,
    whole(tileCY(BEAR_ROW)),
    `the bear's centre y, ${tileCY(BEAR_ROW)}`,
  );
  assertReports(panel, "up", "the bear's facing, 'up', which addBear gives it");
  assertReports(
    panel,
    whole(TARGET_COL),
    `the bear's target column, ${TARGET_COL}`,
  );
  assertReports(
    panel,
    whole(TARGET_ROW),
    `the bear's target row, ${TARGET_ROW}`,
  );

  assertReports(
    panel,
    whole(VEHICLE_COLS.length),
    `how many vehicles are on the strait, ${VEHICLE_COLS.length}`,
  );
  assertReports(
    panel,
    whole(FLOE_COLS.length),
    `how many floes are on the strait, ${FLOE_COLS.length}`,
  );

  // ---- And the game is as it was -------------------------------------------

  assertDeepEqual(
    driftedFields(before, after),
    [],
    "watching the overlay leaves the game as it is: every registered source is a " +
      "pure read (specs/instrumentation.md)",
  );

  // ---- The two flags, read by making the panel answer to them ---------------

  h.calls.length = 0;
  await h.advance(1);
  const steady = withoutMetrics(newLines(baseline, drawnText(h.calls)));

  // The bear's swimming flag: a floe slid under it, which leaves its tile, its
  // target and the floe count exactly as they were.
  h.debug.setFloeX(floes[0], tileLeft(FLOE_UNDER_BEAR_COL));
  h.calls.length = 0;
  await h.advance(1);
  const swimFlipped = withoutMetrics(newLines(baseline, drawnText(h.calls)));
  assertNotEqual(
    swimFlipped.join("\n"),
    steady.join("\n"),
    `the panel's lines once a floe covers the bear's tile, against the lines it ` +
      `drew while the bear was over open water — nothing else the panel reports ` +
      `changed, so a panel carrying each bear's swimming flag draws something ` +
      `different (specs/instrumentation.md)`,
  );

  // The bays: one more filled, which scores nothing and clears nothing.
  h.debug.setBay(FLIPPED_BAY, true);
  h.calls.length = 0;
  await h.advance(1);
  const bayFlipped = withoutMetrics(newLines(baseline, drawnText(h.calls)));
  assertNotEqual(
    bayFlipped.join("\n"),
    swimFlipped.join("\n"),
    `the panel's lines once bay ${FLIPPED_BAY} is filled, against the lines it ` +
      `drew a frame earlier — a panel carrying which bays are filled draws ` +
      `something different (specs/instrumentation.md)`,
  );
});
