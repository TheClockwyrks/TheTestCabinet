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
// changed because it was watched. The two readings are the few driven ticks apart
// that reading the frame and pressing the key cost, so the two clocks the
// specification lets a playing tick move are held to those ticks rather than to
// equality; `diagnostics/held.ts` says which and why.
//
// WHAT AN ENGINELESS BUILD CAN BE ASKED. There is no registry to read: the overlay
// is part of the runtime this build wrote, and specs/instrumentation.md puts the
// backtick key on it and says it "draws the registered sources". So what is
// observable is the TEXT the overlay puts on the canvas once it is open, and the
// reading is that each fact the specification names appears in it. A figure is
// matched as the FIGURE the snapshot reports, in any of the ways a build writes
// one — `4731` and the grouped `4,731` are the same reading — which is what a
// source "reporting the figure the snapshot reports" comes to when the only
// window onto it is the picture. How a build lays that text out, labels it and
// formats it is its own, and none of that is read.
//
// AND THE HUD IS HELD OUT OF THAT READING. The score, the lives and the depth are
// drawn in the strips whether the overlay is open or not, so the frame is read
// TWICE — once with the overlay shut and once with it open — and only the runs the
// second frame added are the overlay's. A build that registered no sources at all
// would otherwise answer for its own HUD.

import { afterEach, beforeEach, it } from "vitest";

import { assertMatches } from "../assert";
import { OVERLAY_KEY } from "../constants";
import { figurePattern } from "../figures";
import { poseApart, spawnPredator } from "../fixtures";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { parkForager } from "../scene";
import { frameOps, textLines } from "../states/screens";
import { added, assertHeld } from "./held";

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

/** Ticks run before the readings, so the light has finished revealing. */
const SETTLE_TICKS = 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws every fact the specification names, and reading it changes nothing", async () => {
  await startPlaying(h);
  const rooms = await poseApart(h, APART, { ring: RING });
  await parkForager(h, rooms.near);
  await h.debug.setScore(POSED_SCORE);
  await h.debug.setLives(POSED_LIVES);
  // Posed BEFORE the hunters, because `setDepth` lays that depth's own roster
  // out and would replace them (specs/instrumentation.md).
  await h.debug.setDepth(POSED_DEPTH);
  await h.debug.clearPredators();
  // Each hunter's mind is off, which holds it exactly where it stands and leaves
  // it deciding nothing (specs/instrumentation.md): what this point reads is
  // whether the overlay REPORTS the game, so a hunter whose flare timer turned
  // over between the two readings would be a moving target rather than a fault.
  // Each stands on a tile of its own, so the three tiles read below are three
  // separate readings.
  for (const [step, kind] of KINDS.entries()) {
    await spawnPredator(
      h,
      kind,
      { tx: rooms.far.tx + step, ty: rooms.far.ty },
      { state: "wander", mind: false },
    );
  }
  // A few ticks so the forager's own light has finished revealing the pocket it
  // stands in: what follows has to be a world nothing but the overlay touches.
  await h.advance(SETTLE_TICKS);

  const before = await h.snapshot();
  const tickBefore = h.tick();

  const shut = textLines(await frameOps(h));
  await h.tap(OVERLAY_KEY);
  const drawn = added(shut, textLines(await frameOps(h)));
  // Before the assertions, so a failing check still leaves the overlay it read.
  await captureStill(h, "sources");
  const after = await h.snapshot();
  const ticksRead = h.tick() - tickBefore;

  /**
   * A number the overlay drew, matched as a figure rather than as a substring.
   *
   * Every conventional writing of the figure counts, so an overlay that groups a
   * score's digit triples — `4,731`, which is what `toLocaleString()` writes by
   * default — reports the figure the snapshot reports just as `4731` does. The
   * ASCII space is not one of the separators, because the runs of a frame are
   * joined with one and `40` beside `130` is two readings rather than `40130`;
   * `figures.ts` states that in full.
   */
  const drewNumber = (value: number, what: string): void => {
    assertMatches(
      drawn,
      figurePattern(value),
      `${what}, which the overlay draws for the source the specification ` +
        "names (specs/instrumentation.md)",
    );
  };

  assertMatches(
    drawn,
    before.screen.toUpperCase(),
    "the screen the overlay draws, which is one of the sources " +
      "specs/instrumentation.md names",
  );
  drewNumber(before.depth, "the depth");
  drewNumber(before.score, "the score");
  drewNumber(before.lives, "the lives");
  drewNumber(before.planktonRemaining, "the plankton remaining");
  drewNumber(before.forager.tx, "the forager's column");
  drewNumber(before.forager.ty, "the forager's row");
  assertMatches(
    drawn,
    before.forager.dir.toUpperCase(),
    "the forager's facing, which is one of the sources " +
      "specs/instrumentation.md names",
  );
  for (const predator of before.predators) {
    assertMatches(
      drawn,
      predator.kind.toUpperCase(),
      `the kind of the ${predator.kind} on the board, which the overlay draws ` +
        "for each predator (specs/instrumentation.md)",
    );
    assertMatches(
      drawn,
      predator.state.toUpperCase(),
      `the state of the ${predator.kind} on the board (specs/instrumentation.md)`,
    );
    drewNumber(predator.tx, `the column of the ${predator.kind}`);
    drewNumber(predator.ty, `the row of the ${predator.kind}`);
  }

  // And every source is a pure read.
  assertHeld(before, after, ticksRead, "the overlay being opened and read");
});
