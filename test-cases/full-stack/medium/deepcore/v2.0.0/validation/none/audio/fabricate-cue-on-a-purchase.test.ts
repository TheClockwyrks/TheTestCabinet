// audio/fabricate-cue-on-a-purchase — a purchase that goes through sounds.
//
// `specs/assets.md`: the `fabricate` cue plays when a purchase or a fabrication
// succeeds.
//
// THREE POINTS, because the sentence names three separate moments a build wires
// separately: a purchase, a fabrication, and the refusal that must stay silent.
// A build that sounds a purchase and forgets a fabrication must grade differently
// from one that sounds neither. The other two are
// `audio/fabricate-cue-on-a-fabrication` and
// `audio/fabricate-cue-not-on-a-refusal`.
//
// THIS ONE IS THE PURCHASE: an upgrade bought at the Upgrade Shop with the
// Credits for it, with the tier afterwards saying the purchase really happened.
//
// A CONTROL RUNS BETWEEN FRAMES, so the cue it raises sounds on the update that
// follows it. The window is opened before the control and closed after the frames
// that carry it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { UPGRADE_PRICES } from "../constants";
import {
  captureReplay,
  createHarness,
  layCamp,
  openScene,
  pinDrill,
  standAtBuilding,
  type Harness,
} from "../harness";
import { armAudio, countSounds } from "./probe";

/** Frames driven after a control, so the update it raised a cue on runs. */
const SETTLE = 2;

/** Frames the clip runs on after the reading. */
const TAIL = 90;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds the fabricate cue on a purchase that goes through", async () => {
  const armed = await armAudio(h);
  await openScene(h);
  await layCamp(h);
  await pinDrill(h);

  const heard = await captureReplay(h, "purchase", async () => {
    await standAtBuilding(h, "upgrade-shop");
    await h.debug.setPanel("upgrade-shop");
    await h.debug.setCredits(UPGRADE_PRICES[2]);

    const played = await countSounds(h, async () => {
      await h.debug.buyUpgrade("fuel");
      await h.advance(SETTLE);
    });
    const after = await h.snapshot();

    // The reading is taken above, over the two frames the control ran in; the
    // rest of the section is the camp carrying on, so the clip is a stretch of
    // play rather than a handful of frames.
    await h.advance(TAIL);
    return { played, after };
  });

  assertEqual(armed, true, "specs/assets.md");
  assertEqual(heard.after.tiers.fuel, 2, "specs/upgrades.md");
  assertGreaterThan(
    heard.played,
    0,
    "specs/assets.md: the fabricate cue plays when a purchase succeeds",
  );
});
