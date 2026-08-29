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
// AND NOTHING ELSE IS DRAWING THE HUNTER. `setCreatureAI(false)` holds every
// creature exactly where it stands and stops it sensing anything
// (specs/instrumentation.md), so it casts no ping and takes no fix; no pulse is
// emitted; the Flarefish is denned, so no bloom reaches the tile. The check reads
// `alert` at the same moment to confirm the detection alert is not what is drawing
// it.
//
// THE TOLERANCE IS THE SIBLING FOG ITEMS'. This item's own wording fixes no number
// for "nothing of the body left drawn"; `25` of the `441` an RGB distance can
// reach is what `fog/unrevealed-black` uses for two tiles being drawn alike, and
// it is used here for the same question about one tile at two moments.

import { afterEach, beforeEach, it } from "vitest";
import { TILE, VISION_GAIN, VISION_MIN } from "../../src/constants";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { poseMaze } from "../fixtures";
import {
  DIR_KEY,
  captureReplay,
  colorDistance,
  createHarness,
  sampleTile,
  startPlaying,
  ticks,
  visibilityOf,
  type Harness,
} from "../harness";
import {
  denAll,
  fromForager,
  graded,
  parkForager,
  requirePred,
  requireSceneHeld,
  requireSwim,
  sceneGuard,
  unmetPrecondition,
} from "../scene";

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

/**
 * How long the swim from `A` to `B` is given, in ticks.
 *
 * Three tiles is `96` logical units, which `FORAGER_SPEED` (`128`) covers in
 * `0.75 s`. Two seconds is a wide margin and still a hard ceiling.
 */
const SWIM_MAX_TICKS = ticks(2);

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

it("Predator bodies are not remembered", async (ctx) => {
  await graded(ctx, async () => {
    await startPlaying(h);
    const board = await poseMaze(h, ART);
    const stand = board.mark("T");
    const near = board.mark("A");
    const far = board.mark("B");
    // Every other hunter into the den; the Gloamfin is left where `setMaze` put
    // it, which is the den too, until this scenario brings it out.
    const quiet = await denAll(h, ["gloamfin"]);
    const gloamfin = requirePred(h.snapshot(), "gloamfin");
    // No plankton, so the remembered tile draws terrain alone and the forager's
    // brightness is only ever the one this check posed.
    h.debug.clearPlankton();
    h.debug.setCreatureAI(false);

    // Reveal `T` with the forager's own light...
    h.debug.setForagerTile(near.tx, near.ty);
    h.debug.setBrightness(1);
    await h.advance(SETTLE_TICKS);
    const lighting = h.snapshot();

    // ...then step back to `B`, where the light no longer reaches it, and take the
    // baseline: the tile as it is drawn with nothing standing on it.
    await parkForager(h, far);
    h.debug.setBrightness(1);
    await h.advance(SETTLE_TICKS);
    const empty = h.snapshot();
    const baseline = sampleTile(h, empty, stand);
    const watch = await sceneGuard(h, quiet, { foragerParked: false });

    // The hunter arrives on the tile, in the dark.
    h.debug.setPredatorTile(gloamfin, stand.tx, stand.ty);
    h.debug.setPredatorDir(gloamfin, "right");
    h.debug.setPredatorState(gloamfin, "wander");
    await h.advance(SETTLE_TICKS);

    const reading = await captureReplay(h, "forget", async () => {
      // The forager comes back to light it.
      h.debug.setForagerTile(near.tx, near.ty);
      h.debug.setBrightness(1);
      await h.advance(LIT_TICKS);
      const held = h.snapshot();
      const litPixel = sampleTile(h, held, stand);

      // And swims back out of range.
      h.hold(DIR_KEY.right);
      const swum = await h.until((s) => s.forager.tx >= far.tx, {
        maxFrames: SWIM_MAX_TICKS,
        poll: 1,
      });
      h.release(DIR_KEY.right);
      await parkForager(h, far);
      h.debug.setBrightness(1);
      await h.advance(SETTLE_TICKS);
      const gone = h.snapshot();
      const gonePixel = sampleTile(h, gone, stand);
      await h.advance(TAIL_TICKS);
      return { held, litPixel, swum, gone, gonePixel };
    });

    requireSceneHeld(reading.gone, watch);

    // Whether the forager swims is `controls/*` and `maze-movement/*`'s verdict.
    if (!reading.swum.hit) {
      requireSwim(
        reading.held.forager,
        reading.gone.forager,
        "swim out of range of the hunter it had lit",
      );
      unmetPrecondition(
        `the forager did not reach the far end of the corridor within ` +
          `${SWIM_MAX_TICKS} ticks, so its light never left the hunter; how fast ` +
          `the forager travels is maze-movement/constant-speed's verdict`,
      );
    }

    // The fixture's own geometry, from the specification's figures: `A` is inside
    // the light at its widest and `B` is outside it.
    const gapFrom = (snapshot: typeof empty): number => {
      const hunter = snapshot.predators[gloamfin];
      if (hunter === undefined) return Number.NaN;
      return fromForager(snapshot, hunter.x, hunter.y);
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
      "the logical units between the forager and the hunter once it has swum " +
        `off, against that same V`,
    );

    // The two states the scenario rests on, each deferring to the point that owns
    // it: the light reached the tile from the near stand, and the fog kept it once
    // the forager swam off. Neither is this point's claim, and a build that misses
    // either is reported by the point that is about it.
    if (visibilityOf(lighting, stand) !== "l") {
      unmetPrecondition(
        `the forager's light did not reach the tile ${3 * TILE} units away from ` +
          `its near stand, so nothing was ever lit there to be forgotten; the ` +
          `light's radius is brightness/widens-vision's verdict, not this one's`,
      );
    }
    if (visibilityOf(reading.gone, stand) !== "r") {
      unmetPrecondition(
        `the tile reported "${visibilityOf(reading.gone, stand)}" rather than ` +
          `"r" once the forager had swum off, so the two readings are not of a ` +
          `remembered tile at all; whether terrain stays remembered is ` +
          `fog/remembered-persists's verdict, not this one's`,
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

    // And what it DRAWS there. The lit reading is the control: without a body on
    // the canvas while the light held it, there is nothing for this point to check
    // has been dropped, and that is the drawing points' verdict rather than this
    // one's.
    const shown = colorDistance(reading.litPixel, baseline);
    if (shown <= ALIKE_MAX) {
      unmetPrecondition(
        `the tile was drawn the same with the hunter lit on it as without it ` +
          `(${shown.toFixed(1)} of 441), so this build draws no body for the fog ` +
          `to have remembered; whether a lit predator is drawn at all is the ` +
          `predator points' verdict, not this one's`,
      );
    }
    assertLessThanOrEqual(
      colorDistance(reading.gonePixel, baseline),
      ALIKE_MAX,
      "the RGB distance, out of 441, between the tile once the hunter is unlit " +
        "and the same tile before it arrived: nothing of where a predator was is " +
        "kept (specs/sensing.md)",
    );
  });
});
