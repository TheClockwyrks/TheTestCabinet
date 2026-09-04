// camera/centers-horizontally — the camera puts the miner on the horizontal
// centre of the mine viewport.
//
// specs/world.md fixes the horizontal camera exactly:
// `camX = clamp(mx - VIEW_W / 2, 0, WORLD_W - VIEW_W)`, where `mx` is the
// miner's centre in world space. This check decides the CENTRING half of that
// rule, so it stands the miner at columns whose unclamped answer falls strictly
// inside the clamp's range; the clamp itself is `camera/horizontal-clamp`.
//
// THE CAMERA IS THE GAME'S OWN UNDER THIS ENGINE. Simple 2D owns no camera, so
// the mine is drawn under a transform the game applies to `api.ctx` itself, and
// `camX` is the quantity that transform is built from. What the snapshot reports
// is therefore the build's own answer to the rule above, which is exactly what
// this check holds it to.
//
// ISOLATION. An empty mine with the miner's two faculties held: travel off, so
// the body stays exactly where each column poses it and gravity cannot carry it
// out of the reading, and the drill off, so nothing cuts. Everything else about
// the miner carries on, the camera included, which is what makes the gate the
// right way to hold a position still (specs/instrumentation.md).

import { afterEach, beforeEach, it } from "vitest";
import { VIEW_W, WORLD_W } from "../constants";
import { assertBetween, assertCloseTo } from "../assert";
import {
  captureStill,
  createHarness,
  minerCenter,
  minerXOn,
  minerYOn,
  openScene,
  pinDrill,
  pinMiner,
  type Harness,
} from "../harness";

/** Columns whose centred camera falls well inside both clamps. */
const COLUMNS = [10, 16, 22];

/** The row the miner is posed on. Any minable row does; the rule is in x alone. */
const ROW = 20;

/**
 * How far the reported camera may sit from the formula, in world units.
 *
 * Half a unit: the specification states `camX` as an exact expression of the
 * miner's centre, so the only slack a conformant build needs is the arithmetic's.
 */
const TOLERANCE_DIGITS = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("centres the miner horizontally wherever the clamp allows it", async () => {
  openScene(h);
  pinMiner(h);
  pinDrill(h);

  for (const col of COLUMNS) {
    h.debug.setMinerPosition(minerXOn(col), minerYOn(ROW));
    h.debug.setMinerVelocity(0, 0);
    await h.advance(1);

    const snapshot = h.snapshot();
    const centred = minerCenter(snapshot.miner).x - VIEW_W / 2;
    // The arrangement's own arithmetic, not a reading of the build: these
    // columns are chosen so the clamp does not bite, and this says so.
    assertBetween(
      centred,
      1,
      WORLD_W - VIEW_W - 1,
      `column ${col} is unclamped`,
    );
    assertCloseTo(
      snapshot.camera.x,
      centred,
      TOLERANCE_DIGITS,
      `specs/world.md: camX is mx - VIEW_W / 2 at column ${col}`,
    );
  }

  captureStill(h, "center");
});
