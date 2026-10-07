// rendering/pause-holds-the-drawn-world-still — the world behind the pause menu
// does not move.
//
// specs/ui.md's screens table gives the `paused` screen as "The pause menu over
// the frozen, dimmed world". Frozen is a claim about the PICTURE, and it is a
// different claim from the one `screens/pause-freezes-the-mine` decides: that
// point reads the simulation, and a build can stop the simulation dead and still
// draw a world that keeps sliding about, because the screen shake is a
// render-space jitter with a clock of its own.
//
// specs/instrumentation.md is what makes that a live hazard: `simTime`
// "accumulates the delta time of every update, whatever the screen", so a jitter
// driven off it keeps running through a pause whose amplitude has stopped
// decaying — and it keeps running for as long as the player leaves the menu up.
//
// THE READING IS A DISPLACEMENT, exactly as `rendering/screen-shake` reads one:
// two luminance profiles over a patch of mine, and the shift that best realigns a
// later frame's profile onto an earlier one. Here the earlier frame is taken
// AFTER the menu is open, so what is measured is movement during the pause and
// nothing before it.
//
// AND IT IS NOT VACUOUS. The shake is confirmed to be in flight first — the same
// displacement reading, taken across the frames between the detonation and the
// pause, must show the picture really moving — so a run that paused after the
// jitter had already died could not pass on a world that was standing still
// anyway.
//
// THE SCENE is `rendering/screen-shake`'s: an island of rock with two cells
// carved out, three columns clear of a posed gas pocket the miner cuts through
// itself, travel held so the blast throws it nowhere, and the gas notice marked
// already fired so no card fades in over the profiles.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import { SHAKE_MIN, TILE } from "../constants";
import {
  captureStill,
  createHarness,
  driveCut,
  fillBlock,
  openScene,
  pinMiner,
  rowInBand,
  standOn,
  type DeepcoreSnapshot,
  type Harness,
} from "../harness";
import { bestShift, readLuma, runOf, stageOf, type StagePoint } from "./sample";

/** The column the pocket is cut in. */
const BLAST_COL = 20;

/** The island of rock the profiles are read over: three columns clear of it. */
const LANDMARK_FROM_COL = 13;
const LANDMARK_TO_COL = 16;

/** How many samples each profile takes, one unit apart. */
const ACROSS_SAMPLES = 320;
const DOWN_SAMPLES = 400;

/** How far either way a slide is searched for, in units. */
const MAX_SHIFT = 24;

/** How many frames after the blast the jitter is confirmed over. */
const SHAKE_FRAMES = 24;

/** Seconds of game time the menu is held up between readings, and their frames. */
const HELD_SECONDS = 1;
const HELD_FRAMES = 30;

/** How many times the paused picture is read, one span apart each. */
const HELD_READINGS = 3;

/** How far the paused picture may move at all, in units. */
const STILL_MAX = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the world behind the pause menu exactly where the pause found it", async () => {
  openScene(h);
  pinMiner(h);
  h.debug.setNoticeFired("gas", true);

  const row = rowInBand("topsoil", h.snapshot().coreRow);
  fillBlock(
    h,
    {
      fromCol: LANDMARK_FROM_COL,
      toCol: LANDMARK_TO_COL,
      fromRow: row - 1,
      toRow: row + 1,
    },
    "rock",
  );
  h.debug.setTile(LANDMARK_FROM_COL + 1, row, "tunnel");
  h.debug.setTile(LANDMARK_TO_COL, row, "tunnel");
  h.debug.setTile(BLAST_COL, row, "gas");
  standOn(h, BLAST_COL, row);
  await h.advance(2);

  /** Where the two profiles fall on screen, through one frame's own camera. */
  const runs = (
    snapshot: DeepcoreSnapshot,
  ): { across: StagePoint[]; down: StagePoint[] } => ({
    across: runOf(
      stageOf(snapshot, LANDMARK_FROM_COL * TILE + 20, row * TILE + TILE / 2),
      ACROSS_SAMPLES,
      "x",
    ),
    down: runOf(
      stageOf(
        snapshot,
        (LANDMARK_FROM_COL + 1) * TILE + TILE / 2,
        (row - 2) * TILE,
      ),
      DOWN_SAMPLES,
      "y",
    ),
  });

  /** How far the drawn world has moved since the profiles in `from` were taken. */
  const slideFrom = (from: {
    across: number[];
    down: number[];
    camera: { x: number; y: number };
  }): number => {
    const snapshot = h.snapshot();
    const here = runs(snapshot);
    return Math.max(
      Math.abs(bestShift(from.across, readLuma(h, here.across), MAX_SHIFT)),
      Math.abs(bestShift(from.down, readLuma(h, here.down), MAX_SHIFT)),
      Math.abs(snapshot.camera.x - from.camera.x),
      Math.abs(snapshot.camera.y - from.camera.y),
    );
  };

  /** The profiles as they stand this frame, to measure a later one against. */
  const mark = (): {
    across: number[];
    down: number[];
    camera: { x: number; y: number };
  } => {
    const snapshot = h.snapshot();
    const here = runs(snapshot);
    return {
      across: readLuma(h, here.across),
      down: readLuma(h, here.down),
      camera: { x: snapshot.camera.x, y: snapshot.camera.y },
    };
  };

  // The pocket goes off under the miner's own drill.
  const cut = await driveCut(h, "down", { col: BLAST_COL, row });
  h.debug.setMinerVelocity(0, 0);

  // The jitter is confirmed live: the picture really is moving when the menu
  // goes up, so a still picture afterwards is the pause's doing.
  const beforePause = mark();
  let live = 0;
  for (let frame = 0; frame < SHAKE_FRAMES; frame += 1) {
    await h.advance(1);
    live = Math.max(live, slideFrom(beforePause));
  }

  h.debug.setScreen("paused");
  await h.advance(1);
  const paused = h.snapshot();
  const held = mark();

  let moved = 0;
  for (let reading = 0; reading < HELD_READINGS; reading += 1) {
    await h.advanceSeconds(HELD_SECONDS, HELD_FRAMES);
    moved = Math.max(moved, slideFrom(held));
  }
  captureStill(h, "frozen");

  assertEqual(
    cut.broke,
    true,
    "the posed gas pocket cut through, so the shake the pause catches really happened",
  );
  assertEqual(paused.screen, "paused", "the menu was up for the whole reading");
  assertGreaterThanOrEqual(
    live,
    SHAKE_MIN,
    "the drawn world moving in the frames before the pause, in units of slide",
  );
  assertLessThanOrEqual(
    moved,
    STILL_MAX,
    `specs/ui.md: the world behind the pause menu is frozen, over ${HELD_READINGS * HELD_SECONDS}s of game time, in units of slide`,
  );
});
