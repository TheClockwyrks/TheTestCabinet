// audio/fabricate-cue — a purchase or a fabrication sounds, a refusal does not.
//
// `specs/assets.md`: the `fabricate` cue plays when a purchase or a fabrication
// succeeds. `specs/gameplay.md` makes an unaffordable action disabled and
// `specs/instrumentation.md` makes a control the game's rules refuse change
// nothing, so a refused purchase is the other direction of the same requirement
// and must be silent.
//
// Three drives, over the same standing miner at the camp: an upgrade bought with
// the Credits for it, the rocket's first component fabricated with the Credits for
// it, and an upgrade attempted with none. The first two must sound and the third
// must not, and the Credits and the tier after each say which of the three
// actually happened.
//
// Counted through the page's own running total rather than by frame, because a
// control runs BETWEEN frames and a sound it emits falls outside every frame's
// bracket.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { ROCKET_COMPONENTS, UPGRADE_PRICES } from "../constants";
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

/** Frames the clip runs on after the last reading. */
const SETTLE = 90;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds on a purchase and a fabrication, and not on a refusal", async () => {
  const armed = await armAudio(h);
  await openScene(h);
  await layCamp(h);
  await pinDrill(h);

  const heard = await captureReplay(h, "confirm", async () => {
    await standAtBuilding(h, "upgrade-shop");
    await h.debug.setPanel("upgrade-shop");
    await h.debug.setCredits(UPGRADE_PRICES[2]);
    const bought = await countSounds(h, async () => {
      await h.debug.buyUpgrade("fuel");
      await h.advance(2);
    });
    const afterBuying = await h.snapshot();

    const refused = await countSounds(h, async () => {
      await h.debug.buyUpgrade("drill");
      await h.advance(2);
    });
    const afterRefusal = await h.snapshot();

    await standAtBuilding(h, "launch-pad");
    await h.debug.setPanel("launch-pad");
    await h.debug.setCredits(ROCKET_COMPONENTS[0].credits);
    const fabricated = await countSounds(h, async () => {
      await h.debug.fabricate();
      await h.advance(2);
    });
    const afterFabricating = await h.snapshot();

    // Every reading is taken above, each over the two frames its control ran in;
    // the rest of the section is the camp carrying on, so the clip is a stretch of
    // play rather than a handful of frames.
    await h.advance(SETTLE);
    return {
      bought,
      refused,
      fabricated,
      afterBuying,
      afterRefusal,
      afterFabricating,
    };
  });

  assertEqual(armed, true, "specs/assets.md");
  assertEqual(heard.afterBuying.tiers.fuel, 2, "specs/upgrades.md");
  assertEqual(heard.afterRefusal.tiers.drill, 1, "specs/gameplay.md");
  assertEqual(
    heard.afterFabricating.rocket.installed.length,
    1,
    "specs/rocket.md",
  );
  assertGreaterThan(heard.bought, 0, "specs/assets.md");
  assertGreaterThan(heard.fabricated, 0, "specs/assets.md");
  assertEqual(heard.refused, 0, "specs/assets.md");
});
