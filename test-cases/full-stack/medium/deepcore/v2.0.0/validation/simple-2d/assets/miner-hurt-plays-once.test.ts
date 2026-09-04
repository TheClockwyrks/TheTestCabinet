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
// the pixels every frame and say nothing about the cycle. Each produced frame is a
// file of its own, decoded into an image of its own, so the `drawImage` over the
// miner names which sprite was on screen and nothing else.
//
// THE BLOW IS LAVA CONTACT, FOR ONE FRAME. `specs/hazards.md` shakes the screen on
// a detonation, a blast, a hard landing and the Core's detonation, and a shaking
// world moves where the miner is drawn; a lava touch is the one blow on its list
// that shakes nothing. `showMiner` turns the cell back to tunnel straight after, so
// the hurt runs from a single blow rather than being re-armed every frame.

import { afterEach, beforeEach, it } from "vitest";
import { HURT_TIME } from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  ticks,
  type Harness,
} from "../harness";
import { frameImages, imageAt } from "./drawn";
import { minerCentre, showMiner } from "./miner";

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ assets: true });
});

afterEach(() => {
  h?.dispose();
});

it("runs the hurt cycle forward without coming back to a frame", async () => {
  await showMiner(h, "hurt");
  const hurt = h.snapshot();
  const at = minerCentre(h);

  const drawn: (string | null)[] = [];
  for (let frame = 0; frame < ticks(HURT_TIME); frame += 1) {
    drawn.push(imageAt(await frameImages(h), at)?.key ?? null);
  }
  const runs = drawn.filter(
    (image, index) => index === 0 || image !== drawn[index - 1],
  );
  const returned = runs.filter((image, index) => runs.indexOf(image) !== index);

  // A second blow, recorded, for the clip the review item declares: the flinch and
  // the state giving way to what the miner is doing. Every reading above was taken
  // over the first one.
  const after = await captureReplay(h, "flinch", async () => {
    await showMiner(h, "hurt");
    await h.advanceSeconds(HURT_TIME * 2);
    return h.snapshot();
  });

  assertEqual(hurt.miner.state, "hurt", "specs/character.md");
  assertGreaterThan(runs.length, 1, "the hurt cycle advances (specs/assets.md)");
  assertEqual(returned.length, 0, "specs/assets.md");
  assertEqual(after.miner.state === "hurt", false, "specs/character.md");
});
