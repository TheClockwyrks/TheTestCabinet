// rendering/screen-shake — a blast jitters the drawn world, and the jitter
// decays out.
//
// specs/assets.md: "The screen shake: a short render-space jitter of the world on
// a gas detonation, an explosives blast, a hard landing, or the Core Sample's
// detonation, scaled to the event and decaying out." specs/hazards.md says the
// same from the hazard's side: a pocket that goes off shakes the screen. The
// frames just after a blast are therefore displaced from the frames before it,
// and the frames well after it are back where they started.
//
// THE READING IS A DISPLACEMENT, NOT A DIFFERENCE. A blast also lights a flash,
// throws a produced particle burst and opens a crater, so a check that only asked
// whether the picture had CHANGED would pass a build with no shake at all. What
// is read instead is how far the picture has SLID: two profiles of the drawn
// world, one across it and one down it, taken over a patch of mine far from the
// blast, and the shift that best realigns each later frame's profile onto the
// frame before the blast. Each profile is levelled against its own mean, so a
// flash that lifts the whole picture moves neither of them.
//
// AND THE SLIDE IS MEASURED PAST THE CAMERA. The jitter the specification asks
// for is a RENDER-SPACE one, so every profile is sampled at the screen points the
// camera in that frame's own snapshot maps its world anchors to. A view that
// moved for a reason of its own — specs/world.md has the camera lead a miner's
// travel — therefore contributes nothing, and what is left is displacement the
// drawing added on top of the camera. Under this engine that transform is the
// game's own `ctx.translate` rather than a camera the runtime owns, which is
// exactly why the reading is taken off the PIXELS and not off the snapshot.
//
// THE SCENE. A small island of the band's rock with two of its cells carved out,
// three columns clear of the pocket — well outside the blast radius
// specs/hazards.md fixes — so the rock the profiles read is the same rock before
// and after. The pocket is posed under the miner and cut through with the miner's
// own drill, which is how a player meets one. A pocket may be posed at any depth,
// and this one is posed in the topsoil so the detonation the miner is standing on
// costs it less hull than it holds.
//
// The miner's travel is held, so it neither is thrown by the blast nor drops
// through the crater, and its velocity is posed back to rest the instant the
// pocket goes off, so the view is standing still while the window runs. The
// hazard notice is marked already fired, because the card specs/ui.md draws over
// the world after a first detonation belongs to the notice checks, and a card
// fading in over the profiles would be read as a change in the world.
//
// THE PRODUCED FILES ARE STOOD UP, so the profiles cross the grain of the real
// tiles: a picture with more structure along it is one a slide of a unit or two
// is more legible in.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import { TILE } from "../../src/constants";
import {
  captureReplay,
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

/** How many frames after the blast the jitter is looked for. */
const SHAKE_FRAMES = 48;

/** How far the picture must slide, in units, for the shake to be visible. */
const SHAKE_MIN = 2;

/** How long after the blast the jitter must have decayed out, in seconds. */
const SETTLE_SECONDS = 3;

/** How many frames the settled picture is sampled over. */
const SETTLED_FRAMES = 12;

/** How far the settled picture may still sit from where it started, in units. */
const SETTLED_MAX = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ assets: true });
});

afterEach(() => {
  h?.dispose();
});

it("jitters the drawn world after a detonation and lets the jitter decay", async () => {
  openScene(h);
  // Travel held, the drill left running: the cut is what sets the blast off.
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
  // Two of the island's cells carved out, so each profile crosses several
  // boundaries and a slide of a unit or two is legible in it.
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

  const base = runs(h.snapshot());
  const baseAcross = readLuma(h, base.across);
  const baseDown = readLuma(h, base.down);

  /** How far the drawn world has slid since the profiles were taken. */
  const slide = (): number => {
    const here = runs(h.snapshot());
    return Math.max(
      Math.abs(bestShift(baseAcross, readLuma(h, here.across), MAX_SHIFT)),
      Math.abs(bestShift(baseDown, readLuma(h, here.down), MAX_SHIFT)),
    );
  };

  // The picture is steady before the blast, so anything read after it is the
  // blast's doing rather than the scene's own animation.
  await h.advance(1);
  const steady = slide();

  const shaken = await captureReplay(h, "shake", async () => {
    const cut = await driveCut(h, "down", { col: BLAST_COL, row });
    // The blast shoves the miner, and specs/world.md has the camera lead a
    // miner's travel; posed back to rest, the view stands still and the only
    // thing left to read is the jitter.
    h.debug.setMinerVelocity(0, 0);
    let peak = 0;
    for (let frame = 0; frame < SHAKE_FRAMES; frame += 1) {
      await h.advance(1);
      peak = Math.max(peak, slide());
    }
    return { cut, peak };
  });

  // And well after it, the picture is back where it was.
  await h.advanceSeconds(SETTLE_SECONDS, SETTLE_SECONDS * 30);
  let settled = 0;
  for (let frame = 0; frame < SETTLED_FRAMES; frame += 1) {
    await h.advance(1);
    settled = Math.max(settled, slide());
  }

  assertEqual(
    shaken.cut.broke,
    true,
    "the posed gas pocket cut through, so the detonation the shake follows actually happened",
  );
  assertLessThanOrEqual(
    steady,
    SETTLED_MAX,
    "the drawn world standing still before the blast, in units of slide under the camera's own mapping",
  );
  assertGreaterThanOrEqual(
    shaken.peak,
    SHAKE_MIN,
    `the drawn world displaced within ${SHAKE_FRAMES} frames of the detonation, in units of slide under the camera's own mapping`,
  );
  assertLessThanOrEqual(
    settled,
    SETTLED_MAX,
    `the jitter decayed out ${SETTLE_SECONDS}s after the detonation, in units of slide under the camera's own mapping`,
  );
});
