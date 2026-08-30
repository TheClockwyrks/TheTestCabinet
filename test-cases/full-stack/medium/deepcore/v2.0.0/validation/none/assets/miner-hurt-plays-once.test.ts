// assets/miner-hurt-plays-once — the flinch runs through and stops.
//
// `specs/assets.md`: the game plays the cycle for the miner's state, "looping
// every cycle but `hurt`, which plays once". `specs/character.md` gives the window
// it plays in: the `hurt` state "holds for `HURT_TIME` (`0.4`) seconds from the
// blow, then gives way to whatever the miner is doing".
//
// So the miner is hurt once and the picture drawn over it is read on every frame
// of that window. A cycle that PLAYS ONCE never comes back to a drawing it has
// already left: it runs forward and then holds. A cycle that loops does come back,
// and `HURT_TIME` is nearly five frames at `ANIM_FPS`, which is long enough for a
// two-frame cycle to come round twice. That is the whole reading, and it needs no
// knowledge of how many frames the build's cycle has.
//
// WHAT IS READ IS THE PICTURE, NOT THE PIXELS. `specs/assets.md` fires produced
// effects at a hurt miner, and a puff of debris drifting across its box would move
// the pixels every frame and say nothing about the cycle. The recorder names each
// picture a frame drew, so what comes back is which sprite was on screen and
// nothing else.
//
// THE BLOW IS LAVA CONTACT, FOR ONE FRAME. `specs/hazards.md` shakes the screen on
// a detonation, a blast, a hard landing and the Core's detonation, and a shaking
// world moves where the miner is drawn; a lava touch is the one blow on its list
// that shakes nothing. The cell is turned back to tunnel straight after, so the
// hurt runs from a single blow rather than being re-armed every frame.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  HULL_MAX,
  HURT_TIME,
  MINER_H,
  MINER_W,
  PLAYABLE_COL_MIN,
} from "../constants";
import {
  captureReplay,
  createHarness,
  layFloor,
  openScene,
  pinDrill,
  pinMiner,
  stageTiers,
  standOn,
  worldToStage,
  type Harness,
} from "../harness";
import { imageAt, recordImages } from "./drawn";

/** A deepstone row, the shallowest band `specs/world.md` puts lava in. */
const ROW = 300;
const COL = PLAYABLE_COL_MIN + 8;

/** How finely the window is sampled. */
const SAMPLE_HZ = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("runs the hurt cycle forward without coming back to a frame", async () => {
  await openScene(h);
  await pinDrill(h);
  await stageTiers(h, { hull: 5 });
  await h.debug.setHull(HULL_MAX[4]);
  await layFloor(h, ROW);
  await standOn(h, COL, ROW);
  await pinMiner(h);
  await h.debug.setNoticeFired("lava", true);
  await h.advanceSeconds(0, 1);

  const posed = await h.snapshot();
  const at = worldToStage(
    posed,
    posed.miner.x + MINER_W / 2,
    posed.miner.y + MINER_H / 2,
  );

  // One frame of contact, and then the lava is gone again.
  await h.debug.setTile(COL, ROW - 1, "lava");
  await h.advanceSeconds(1 / SAMPLE_HZ, 1);
  await h.debug.setTile(COL, ROW - 1, "tunnel");
  const hurt = await h.snapshot();

  const samples = Math.round(HURT_TIME * SAMPLE_HZ);
  const { frames } = await recordImages(h, async () => {
    for (let sample = 0; sample < samples; sample += 1) {
      await h.advanceSeconds(1 / SAMPLE_HZ, 1);
    }
  });

  const drawn = frames.map((frame) => imageAt(frame, at)?.image ?? null);
  const runs = drawn.filter(
    (image, index) => index === 0 || image !== drawn[index - 1],
  );
  const returned = runs.filter((image, index) => runs.indexOf(image) !== index);

  // A second blow, recorded, for the clip the review item declares: the flinch and
  // the state giving way to what the miner is doing, at a frame rate a reviewer can
  // scrub. Every reading above was taken over the first one.
  const after = await captureReplay(h, "flinch", async () => {
    await h.debug.setTile(COL, ROW - 1, "lava");
    await h.advanceSeconds(1 / SAMPLE_HZ, 1);
    await h.debug.setTile(COL, ROW - 1, "tunnel");
    await h.advanceSeconds(
      HURT_TIME * 2,
      Math.round(HURT_TIME * 2 * SAMPLE_HZ),
    );
    return h.snapshot();
  });

  assertEqual(hurt.miner.state, "hurt", "specs/character.md");
  assertGreaterThan(
    runs.length,
    1,
    "the hurt cycle advances (specs/assets.md)",
  );
  assertEqual(returned.length, 0, "specs/assets.md");
  assertEqual(after.miner.state === "hurt", false, "specs/character.md");
});
