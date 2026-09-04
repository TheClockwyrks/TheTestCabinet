// diagnostics/sources-registered — the game registers the diagnostics it owes.
//
// specs/instrumentation.md, "Diagnostics": "Register at least the current
// `screen` and `depth`, the `score` and `lives`, the brightness `G`, the light
// radius `V`, the sonar and ink cooldowns, the plankton remaining, the forager's
// tile and facing, and, for each predator, its kind, state, tile, speed and
// whether its alert is firing. Those are the same facts the snapshot reports.
// Keep each source short enough to read on a line and keep every one a pure read,
// so watching the overlay leaves the simulation as it is."
//
// WHAT THIS POINT DECIDES, and why it is not the whole of that sentence. A source
// reports a fact as TEXT, and how it formats that text is the build's: `G 0.42`,
// `G 42%` and `G .42` all report the same brightness honestly. So the facts held
// against the snapshot here are the ones whose reading is exact whatever the
// formatting — the screen, the depth, the score, the lives, the plankton
// remaining, the forager's tile and facing, and each predator's kind, state and
// tile. The brightness `G`, the light radius `V`, the two cooldowns, a predator's
// speed and whether its alert is firing are all continuous or derived figures a
// build renders as it chooses, and a check on them would grade the rendering
// rather than the registry. test-case.toml's item text says the same, so the
// verdict a reviewer reads is the reading this makes.
//
// THE WORLD IS POSED WELL OFF ITS OPENING VALUES FIRST. A dive that has only just
// begun reports a score of `0`, `START_LIVES` lives and depth `1`, and every one
// of those is a figure a build could have written into an overlay as a constant.
// So the score, the lives and the depth are posed onto figures nothing else on
// the board carries, and one hunter of each kind is stood on a tile of its own.
//
// AND THE READS ARE HELD TO BE PURE. The whole snapshot is taken before the
// sources are read and again after, and the two have to agree: a source that
// advanced a timer, consumed a queue or moved a body would show as a snapshot that
// changed because it was watched.
//
// UNDER AN ENGINE THE REGISTRY IS READABLE. The engine holds the sources the game
// registered and hands back what each reports, so each reading is held against the
// snapshot taken at the same moment rather than against a picture of it. What the
// OVERLAY does with those readings is the engine's own work and is not graded
// here, which is why `diagnostics.overlay-toggle` names `none` alone.
//
// A SOURCE IS FOUND BY WHAT IT REPORTS, not by the name it was registered under.
// specs/instrumentation.md names the FACTS a build owes and leaves their labels to
// it — `pred 0`, `Lanternjaw`, `p0.state` are all reasonable — so what this asks
// is that some source's own REPORTED VALUE carries each fact. The names are held
// out of the reading deliberately: a build that registered `predator 2` and
// reported nothing from it would otherwise answer for the two lives it never read.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual, assertTrue } from "../assert";
import { poseApart, spawnPredator } from "../fixtures";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { parkForager } from "../scene";

/** The three hunters, one of each stood on the board. */
const KINDS = ["lanternjaw", "gloamfin", "flarefish"] as const;

/**
 * Figures posed well off the values a dive opens on.
 *
 * Each is above `GRID_COLS` (`36`), the widest a tile coordinate runs, so a
 * figure found among the readings is the one this posed rather than a column or
 * a row that happened to carry the same digits.
 */
const POSED_SCORE = 4731;
const POSED_LIVES = 41;
const POSED_DEPTH = 37;

/** How far apart the forager's room and the hunters' ring stand, in tiles. */
const APART = 10;

/** How much corridor that ring holds, in tiles. */
const RING = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("registers every fact the specification names, and reading it changes nothing", async () => {
  startPlaying(h);
  const rooms = await poseApart(h, APART, { ring: RING });
  await parkForager(h, rooms.near);
  h.debug.setScore(POSED_SCORE);
  h.debug.setLives(POSED_LIVES);
  // Posed BEFORE the hunters, because `setDepth` lays that depth's own roster out
  // in the den and would leave it standing beside them.
  h.debug.setDepth(POSED_DEPTH);
  h.debug.clearPredators();
  // One of each kind, each on a tile of its own along the ring so the three tiles
  // read below are three separate readings, and each mind off so nothing decides
  // anything between the reading and the snapshot it is held against.
  for (const [step, kind] of KINDS.entries()) {
    await spawnPredator(
      h,
      kind,
      { tx: rooms.far.tx + step, ty: rooms.far.ty },
      { state: "wander", mind: false },
    );
  }

  const before = h.snapshot();

  const readings = h.engine.diagnostics();
  // Before the assertions, so a failing check still leaves the dive it read.
  captureStill(h, "sources");
  const after = h.snapshot();

  /** What each source REPORTS, one entry per source. Names are not read. */
  const values = readings.map((one) =>
    String(one.value ?? one.error ?? "").toUpperCase(),
  );

  /** How a failure shows the reader what the registry answered. */
  const shown = readings
    .map((one) => `${one.name}: ${String(one.value ?? one.error ?? "")}`)
    .join(" | ");

  /** Some one source's reported value carries `value`. */
  const reports = (value: string, what: string): void => {
    assertTrue(
      values.some((one) => one.includes(value.toUpperCase())),
      `${what}, which specs/instrumentation.md names among the sources a ` +
        `build registers — the ${String(readings.length)} it registered read ` +
        `[${shown}]`,
    );
  };

  /** A number, matched as a figure rather than as a run of digits inside one. */
  const reportsNumber = (value: number, what: string): void => {
    const figure = new RegExp(`(?<!\\d)${String(value)}(?!\\d)`);
    assertTrue(
      values.some((one) => figure.test(one)),
      `${what}, which specs/instrumentation.md names among the sources a ` +
        `build registers — the ${String(readings.length)} it registered read ` +
        `[${shown}]`,
    );
  };

  assertTrue(
    readings.length > 0,
    "diagnostic sources registered with the engine, which " +
      "specs/instrumentation.md requires a build to register",
  );
  reports(before.screen, "the screen");
  reportsNumber(before.depth, "the depth");
  reportsNumber(before.score, "the score");
  reportsNumber(before.lives, "the lives");
  reportsNumber(before.planktonRemaining, "the plankton remaining");
  reportsNumber(before.forager.tx, "the forager's column");
  reportsNumber(before.forager.ty, "the forager's row");
  reports(before.forager.dir, "the forager's facing");
  for (const predator of before.predators) {
    reports(predator.kind, `the kind of the ${predator.kind} on the board`);
    reports(predator.state, `the state of the ${predator.kind} on the board`);
    reportsNumber(predator.tx, `the column of the ${predator.kind}`);
    reportsNumber(predator.ty, `the row of the ${predator.kind}`);
  }

  // And every source is a pure read.
  assertEqual(
    JSON.stringify({ ...after, simTime: 0 }),
    JSON.stringify({ ...before, simTime: 0 }),
    "the whole snapshot across every diagnostic source being read, which each " +
      "of them leaves as it is (specs/instrumentation.md)",
  );
});
