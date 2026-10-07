// audio/fabricate-cue-not-on-a-refusal — a purchase the balance refuses is silent.
//
// `specs/assets.md` plays the `fabricate` cue when a purchase or a fabrication
// SUCCEEDS. `specs/expedition.md` makes an unaffordable action disabled and
// `specs/instrumentation.md` makes a control the game's rules refuse change
// nothing, so a refused purchase is the other direction of the same requirement
// and must be silent.
//
// THREE POINTS, because the sentence names three separate moments a build wires
// separately: a purchase, a fabrication, and this refusal. The other two are
// `audio/fabricate-cue-on-a-purchase` and `audio/fabricate-cue-on-a-fabrication`.
//
// THE REFUSAL IS A REAL ONE. `specs/upgrades.md` puts every track's first step at
// the ladder's first rung and has a purchase deduct its price immediately, so a
// balance opened with exactly that much has nothing left for a second track and
// the shop disables it. The tier afterwards says nothing was bought.
//
// A CONTROL RUNS BETWEEN FRAMES, so a cue it raised would sound on the update
// that follows it. The window is opened before the control and closed after the
// frames that carry it, which is the same bracket the two sounding points use.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
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

it("stays silent on a purchase the balance cannot cover", async () => {
  const armed = await armAudio(h);
  await openScene(h);
  await layCamp(h);
  await pinDrill(h);

  const heard = await captureReplay(h, "refusal", async () => {
    await standAtBuilding(h, "upgrade-shop");
    await h.debug.setPanel("upgrade-shop");
    // The rung the first step costs, less one Credit: enough that the balance is
    // the only thing refusing it. `UPGRADE_PRICES` is indexed by the tier being
    // bought, so the first step's rung is index 2.
    await h.debug.setCredits(UPGRADE_PRICES[2] - 1);

    const played = await countSounds(h, async () => {
      await h.debug.buyUpgrade("drill");
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
  assertEqual(heard.after.tiers.drill, 1, "specs/expedition.md");
  assertEqual(
    heard.played,
    0,
    "specs/assets.md: the fabricate cue plays only when a purchase succeeds",
  );
});
