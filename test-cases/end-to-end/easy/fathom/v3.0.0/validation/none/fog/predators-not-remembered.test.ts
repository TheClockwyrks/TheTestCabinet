// fog/predators-not-remembered — a predator body is not remembered.
//
// `specs/sensing.md` separates what the fog keeps from what it does not. Terrain
// and plankton "stay remembered for the rest of the current maze"; a predator's
// body "is drawn only while it is lit this instant... Between those glimpses it is
// not drawn, wherever it stands, and nothing of where it was is kept."
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
// `B` is outside `V` at its widest (`160`) and inside the kindle circle at the same
// `G` (`320`), so the tile is unlit and still drawn in both.
//
// AND NOTHING ELSE IS DRAWING THE HUNTER. The board holds the one Gloamfin this
// point is about and nothing else — no other hunter, no drifter, no plankton — and
// its own mind is off, so it "holds exactly where it stands... senses nothing,
// decides nothing" (`specs/instrumentation.md`): it casts no ping and takes no
// fix, no pulse is emitted, and there is no Flarefish to bloom. The check reads
// `alert` at the same moment to confirm the detection alert is not what is drawing
// it.
//
// THE TOLERANCE IS THE SIBLING FOG POINTS'. This point's own wording fixes no
// number for "nothing of the body left drawn"; `25` of the `441` an RGB distance
// can reach is what `fog/unrevealed-black` uses for two tiles being drawn alike,
// and it is used here for the same question about one tile at two moments.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  ARROW_KEY,
  BRIGHT_HOLD,
  TILE,
  VISION_GAIN,
  VISION_MIN,
} from "../constants";
import { visibilityAt } from "../maze";
import { placeForager, poseMaze, spawnPredator } from "../fixtures";
import {
  captureReplay,
  colorDistance,
  createHarness,
  sampleTiles,
  ticks,
  type Harness,
  startPlaying,
} from "../harness";
import { parkForager, requireSceneHeld, sceneGuard } from "../scene";

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
 * See the header: this point states no figure of its own, and this is the bound
 * `fog/unrevealed-black` puts on two tiles being drawn alike.
 */
const ALIKE_MAX = 25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("drops a predator body once the light leaves it, keeping nothing on the tile", async () => {
  await startPlaying(h);
  const board = await poseMaze(h, ART);
  const stand = board.mark("T");
  const near = board.mark("A");
  const far = board.mark("B");
  // The board is bare, so the remembered tile draws terrain alone and the
  // forager's brightness is only ever the one this check posed.

  // Reveal `T` with the forager's own light...
  await placeForager(h, near);
  await h.debug.setBrightness(1);
  await h.debug.setBrightHold(BRIGHT_HOLD);
  await h.skip(SETTLE_TICKS);
  const lighting = await h.snapshot();

  // ...then step back to `B`, where the light no longer reaches it, and take the
  // baseline: the tile as it is drawn with nothing standing on it.
  await parkForager(h, far);
  await h.debug.setBrightness(1);
  await h.debug.setBrightHold(BRIGHT_HOLD);
  await h.skip(SETTLE_TICKS);
  const empty = await h.snapshot();
  const [baseline] = await sampleTiles(h, empty.grid, [stand]);
  const guard = await sceneGuard(h, { foragerParked: false });

  // The hunter arrives on the tile, in the dark, and its own mind is off so it
  // holds there for the whole reading.
  const gloamfin = await spawnPredator(h, "gloamfin", stand, {
    dir: "right",
    state: "wander",
    mind: false,
  });
  await h.skip(SETTLE_TICKS);

  const reading = await captureReplay(h, "forget", async () => {
    // The forager comes back to light it.
    await placeForager(h, near);
    await h.debug.setBrightness(1);
    await h.debug.setBrightHold(BRIGHT_HOLD);
    await h.advance(LIT_TICKS);
    const held = await h.snapshot();
    const [litColor] = await sampleTiles(h, held.grid, [stand]);

    // And swims back out of range.
    await h.hold(ARROW_KEY.right);
    const swum = await h.until((s) => s.forager.tx >= far.tx, {
      maxTicks: SWIM_MAX_TICKS,
      poll: 1,
    });
    await h.release(ARROW_KEY.right);
    await parkForager(h, far);
    await h.debug.setBrightness(1);
    await h.debug.setBrightHold(BRIGHT_HOLD);
    await h.advance(SETTLE_TICKS);
    const gone = await h.snapshot();
    const [goneColor] = await sampleTiles(h, gone.grid, [stand]);
    await h.advance(TAIL_TICKS);
    return { held, litColor, swum, gone, goneColor };
  });

  requireSceneHeld(reading.gone, guard);

  assertEqual(
    reading.swum.hit,
    true,
    `the forager reached the far end of the corridor within ${SWIM_MAX_TICKS} ` +
      "ticks, which is how its light leaves the hunter",
  );

  // The fixture's own geometry, from the specification's figures: `A` is inside the
  // light at its widest and `B` is outside it.
  assertLessThanOrEqual(
    3 * TILE,
    VISION_MAX,
    `the ${3 * TILE} logical units between the forager's near stand and the ` +
      `hunter's tile, against V at G = 1 (VISION_MIN + VISION_GAIN = ${VISION_MAX})`,
  );
  const hunter = reading.gone.predators[gloamfin];
  assertGreaterThan(
    Math.hypot(
      (hunter?.x ?? Number.NaN) - reading.gone.forager.x,
      (hunter?.y ?? Number.NaN) - reading.gone.forager.y,
    ),
    VISION_MAX,
    `the logical units between the forager and the hunter once it has swum off, ` +
      `against that same V`,
  );

  // The two states the scenario rests on: the light reached the tile from the
  // near stand, and the fog kept it once the forager swam off. Without both,
  // the two readings are not of a remembered tile at all.
  assertEqual(
    visibilityAt(lighting, stand),
    "l",
    `the visibility of the tile ${3 * TILE} units from the forager's near ` +
      "stand, which has to be lit for anything to be forgotten there",
  );
  assertEqual(
    visibilityAt(reading.gone, stand),
    "r",
    "the visibility of that tile once the forager had swum off, which has to " +
      "be remembered for the two readings to be of a remembered tile",
  );

  // What the build SAYS about the body.
  assertEqual(
    reading.held.predators[gloamfin]?.lit,
    true,
    "the hunter's `lit` while the forager's light held it",
  );
  assertEqual(
    hunter?.lit,
    false,
    "the hunter's `lit` once the forager had swum out of range",
  );
  assertEqual(
    hunter?.alert,
    false,
    "the hunter's `alert` at that moment, so nothing but the light had been " +
      "drawing it",
  );

  // And what it DRAWS there. The lit reading is the control: without a body on
  // the canvas while the light held it, there is nothing for this point to
  // check has been dropped.
  const shown = colorDistance(reading.litColor, baseline);
  assertGreaterThan(
    shown,
    ALIKE_MAX,
    "how far the tile with the hunter lit on it was drawn from the same tile " +
      "empty, of 441 — a body drawn there is what the fog then has to forget",
  );
  assertLessThanOrEqual(
    colorDistance(reading.goneColor, baseline),
    ALIKE_MAX,
    `the RGB distance, out of 441, between the tile once the hunter is unlit and ` +
      `the same tile before it arrived: nothing of where a predator was is kept ` +
      `(specs/sensing.md)`,
  );
});
