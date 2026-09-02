// fog/predators-not-remembered — a predator body is not remembered.
//
// specs/sensing.md separates what the fog keeps from what it does not. Terrain and
// plankton "stay remembered for the rest of the current maze"; a predator's body
// "is drawn only while it is lit this instant... Between those glimpses it is not
// drawn, wherever it stands, and nothing of where it was is kept."
//
// So the reading is taken twice on ONE TILE, in the SAME lighting, with the only
// difference being whether the hunter has been seen there. `T` is revealed by the
// forager's own light and then left behind, so it is a remembered tile drawn dim.
// Its pixels are sampled with nothing on it — that is the baseline, the tile
// "before it arrived". The Gloamfin is then posed onto it, the forager comes back
// to light it, and the forager swims away again. The tile must come back to the
// baseline: a build that keeps the body in memory leaves it drawn there.
//
// THE SAMPLES ARE TAKEN FROM THE SAME SPOT. Both readings are made with the
// forager parked on `B`, `192` logical units from `T`, and with `G` posed to `1`
// immediately before each. That matters in both variants — the light's radius is
// `V = VISION_MIN + VISION_GAIN * G` and under `kindle` the maze is drawn only
// inside a circle that also grows with `G` — so anything that depends on where the
// forager is standing or how bright it is affects the two readings identically.
// `B` is outside `V` at its widest (`160`) and inside the kindle circle at the
// same `G` (`320`), so the tile is unlit and still drawn in both.
//
// AND NOTHING ELSE IS DRAWING THE HUNTER. It is the only creature on the board,
// and it is added with `mind: false`, which holds it exactly where it stands and
// stops it sensing anything (specs/instrumentation.md), so it casts no ping and
// takes no fix; no pulse is emitted; there is no Flarefish to bloom over the tile.
// The check reads `alert` at the same moment to confirm the detection alert is not
// what is drawing it.
//
// THE TOLERANCE IS THE SIBLING FOG ITEMS'. This item's own wording fixes no number
// for "nothing of the body left drawn"; `25` of the `441` an RGB distance can
// reach is what `fog/unrevealed-black` uses for two tiles being drawn alike, and
// it is used here for the same question about one tile at two moments.

import { afterEach, beforeEach, it } from "vitest";
import {
  BRIGHT_HOLD,
  TILE,
  VISION_GAIN,
  VISION_MIN,
} from "../constants";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
  fail,
} from "../assert";
import { poseMaze, spawnPredator } from "../fixtures";
import {
  captureReplay,
  centerOf,
  colorDistance,
  createHarness,
  sampleColor,
  startPlaying,
  visibilityAt,
  type Harness,
} from "../harness";
import { parkForager, requireSceneHeld, sceneGuard } from "../scene";
import type { Tile } from "../maze";

/**
 * The board: `T` is the tile the Gloamfin stands on, `A` is where the forager
 * stands to light it, and `B` is where it swims to so the light leaves.
 *
 * `A` is three tiles from `T` (`96` units, inside `V` at `G = 1`) and `B` is six
 * (`192`, outside it). The corridor runs on past `B` so the forager is not stopped
 * by rock at the end of its swim.
 */
const ART = ["T..A..B.."] as const;

/** The widest the light pocket ever opens, in logical units: `V` at `G = 1`. */
const VISION_MAX = VISION_MIN + VISION_GAIN;

/** Ticks run after a pose, so the frame that is read was drawn under it. */
const SETTLE_TICKS = 2;

/** Ticks the clip holds on the lit hunter before the forager swims off. */
const LIT_TICKS = 30;

/** Ticks the clip lingers on the emptied tile before the recording ends. */
const TAIL_TICKS = 36;

/**
 * How far the tile may be drawn from its own baseline, as an RGB distance out of
 * the `441` that separates black from white.
 *
 * See the header: this item states no figure of its own, and this is the bound
 * `fog/unrevealed-black` puts on two tiles being drawn alike.
 */
const ALIKE_MAX = 25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** The mean color over a cluster at a tile's center. */
function tileColor(snapshot: ReturnType<Harness["snapshot"]>, tile: Tile) {
  const at = centerOf(snapshot, tile);
  return sampleColor(h, at.x, at.y);
}

it("Predator bodies are not remembered", async () => {
  startPlaying(h);
  const board = await poseMaze(h, ART);
  const stand = board.mark("T");
  const near = board.mark("A");
  const far = board.mark("B");
  // The board carries no plankton, so the remembered tile draws terrain alone and
  // the forager's brightness is only ever the one this check posed.

  // Reveal `T` with the forager's own light...
  h.debug.setForagerTile(near.tx, near.ty);
  h.debug.setBrightness(1);
  h.debug.setBrightHold(BRIGHT_HOLD);
  await h.advance(SETTLE_TICKS);
  const lighting = h.snapshot();

  // ...then step back to `B`, where the light no longer reaches it, and take the
  // baseline: the tile as it is drawn with nothing standing on it.
  await parkForager(h, far);
  h.debug.setBrightness(1);
  h.debug.setBrightHold(BRIGHT_HOLD);
  await h.advance(SETTLE_TICKS);
  const empty = h.snapshot();
  const baseline = tileColor(empty, stand);
  const watch = await sceneGuard(h, { foragerParked: false });

  // The hunter arrives on the tile, in the dark — the only one on the board, and
  // held there, because this point is about what is DRAWN where it stands.
  const gloamfin = await spawnPredator(h, "gloamfin", stand, {
    dir: "right",
    mind: false,
  });
  await h.advance(SETTLE_TICKS);

  const reading = await captureReplay(h, "forget", async () => {
    // The forager comes back to light it.
    h.debug.setForagerTile(near.tx, near.ty);
    h.debug.setBrightness(1);
    h.debug.setBrightHold(BRIGHT_HOLD);
    await h.advance(LIT_TICKS);
    const held = h.snapshot();
    const litPixel = tileColor(held, stand);

    // And stands back out of range. It is carried there rather than driven: what
    // this point reads is a tile drawn from two standing places, and whether a
    // held action carries the forager anywhere is the movement points' subject.
    await parkForager(h, far);
    h.debug.setBrightness(1);
    h.debug.setBrightHold(BRIGHT_HOLD);
    await h.advance(SETTLE_TICKS);
    const gone = h.snapshot();
    const gonePixel = tileColor(gone, stand);
    await h.advance(TAIL_TICKS);
    return { held, litPixel, gone, gonePixel };
  });

  requireSceneHeld(reading.gone, watch);

  // The fixture's own geometry, from the specification's figures: `A` is inside the
  // light at its widest and `B` is outside it.
  const gapFrom = (snapshot: typeof empty): number => {
    const hunter = snapshot.predators[gloamfin];
    if (hunter === undefined) return Number.NaN;
    return Math.hypot(
      hunter.x - snapshot.forager.x,
      hunter.y - snapshot.forager.y,
    );
  };
  assertLessThanOrEqual(
    3 * TILE,
    VISION_MAX,
    `the ${3 * TILE} logical units between the forager's near stand and the ` +
      `hunter's tile, against V at G = 1 (VISION_MIN + VISION_GAIN = ${VISION_MAX})`,
  );
  assertGreaterThan(
    gapFrom(reading.gone),
    VISION_MAX,
    "the logical units between the forager and the hunter once it has swum off, " +
      "against that same V",
  );

  // The two states the scenario rests on, each deferring to the point that owns it:
  // the light reached the tile from the near stand, and the fog kept it once the
  // forager swam off. Neither is this point's claim, and a build that misses either
  // is reported by the point that is about it.
  if (visibilityAt(lighting, stand) !== "l") {
    fail(
      `the forager's light to reach the tile ${3 * TILE} units away from its near ` +
        "stand, so something is lit there to be forgotten",
      `the tile reported "${visibilityAt(lighting, stand)}"`,
    );
  }
  if (visibilityAt(reading.gone, stand) !== "r") {
    fail(
      "the tile to stay remembered once the forager had swum off, so the two " +
        "readings are of a remembered tile",
      `the tile reported "${visibilityAt(reading.gone, stand)}"`,
    );
  }

  // What the build SAYS about the body.
  assertEqual(
    reading.held.predators[gloamfin]?.lit,
    true,
    "the hunter's `lit` while the forager's light held it",
  );
  assertEqual(
    reading.gone.predators[gloamfin]?.lit,
    false,
    "the hunter's `lit` once the forager had swum out of range",
  );
  assertEqual(
    reading.gone.predators[gloamfin]?.alert,
    false,
    "the hunter's `alert` at that moment, so nothing but the light had been " +
      "drawing it",
  );

  // And what it DRAWS there. The lit reading is the control: without a body on the
  // canvas while the light held it, there is nothing for this point to check has
  // been dropped, and that is the drawing points' verdict rather than this one's.
  const shown = colorDistance(reading.litPixel, baseline);
  if (shown <= ALIKE_MAX) {
    fail(
      "the build to draw a body on the tile while the forager's light held the " +
        "hunter, so there is something for the fog to have remembered",
      `${shown.toFixed(1)} of 441 between the lit tile and the empty one`,
    );
  }
  assertLessThanOrEqual(
    colorDistance(reading.gonePixel, baseline),
    ALIKE_MAX,
    "the RGB distance, out of 441, between the tile once the hunter is unlit and " +
      "the same tile before it arrived: nothing of where a predator was is kept " +
      "(specs/sensing.md)",
  );
});
