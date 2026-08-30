// audio/fabricate-cue — a purchase or a fabrication sounds, a refusal does not.
//
// `specs/assets.md`: the `fabricate` cue plays when a purchase or a fabrication
// succeeds. `specs/gameplay.md` makes an unaffordable action disabled and
// `specs/instrumentation.md` makes a control the game's rules refuse change
// nothing, so a refused purchase is the other direction of the same requirement
// and must be silent.
//
// Three drives, over the same standing miner at the camp: an upgrade bought with
// exactly the Credits for it, a second upgrade attempted with the nothing that
// purchase left, and the rocket's first component fabricated with the Credits for
// it. The first and the last must sound `fabricate` by name and the middle one
// must not, and the Credits and the tier after each say which of the three
// actually happened.
//
// THE REFUSAL IS A REAL ONE. `specs/upgrades.md` puts every track's first step at
// `UPGRADE_PRICES[0]` (`300`) and has a purchase deduct its price immediately, so
// a bay opened with exactly that much has nothing left for the second track and
// the shop disables it.
//
// A CONTROL RUNS BETWEEN FRAMES, so the cue it raises sounds on the update that
// follows it. Each window is opened before the control and closed after the frames
// that carry it.

import { afterEach, beforeEach, it } from "vitest";
import { CUES, ROCKET_COMPONENTS, UPGRADE_PRICES } from "../../src/constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  layCamp,
  openScene,
  pinDrill,
  standAtBuilding,
  type Harness,
} from "../harness";
import { over, playsIn, watchAudio } from "./cues";

/** Frames driven after a control, so the update it raised a cue on runs. */
const SETTLE = 2;

/** Frames the clip runs on after the last reading. */
const TAIL = 90;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sounds the fabricate cue on a purchase and a fabrication, and not on a refusal", async () => {
  openScene(h);
  layCamp(h);
  pinDrill(h);

  const log = watchAudio(h);
  const heard = await captureReplay(h, "confirm", async () => {
    standAtBuilding(h, "upgrade-shop");
    h.debug.setPanel("upgrade-shop");
    h.debug.setCredits(UPGRADE_PRICES[0]);
    const bought = await over(h, async () => {
      h.debug.buyUpgrade("fuel");
      await h.advance(SETTLE);
    });
    const afterBuying = h.snapshot();

    const refused = await over(h, async () => {
      h.debug.buyUpgrade("drill");
      await h.advance(SETTLE);
    });
    const afterRefusal = h.snapshot();

    standAtBuilding(h, "launch-pad");
    h.debug.setPanel("launch-pad");
    h.debug.setCredits(ROCKET_COMPONENTS[0].credits);
    const fabricated = await over(h, async () => {
      h.debug.fabricate();
      await h.advance(SETTLE);
    });
    const afterFabricating = h.snapshot();

    // Every reading is taken above, each over the two frames its control ran in;
    // the rest of the section is the camp carrying on, so the clip is a stretch of
    // play rather than a handful of frames.
    await h.advance(TAIL);
    return {
      bought: playsIn(log, CUES.fabricate, bought).length,
      refused: playsIn(log, CUES.fabricate, refused).length,
      fabricated: playsIn(log, CUES.fabricate, fabricated).length,
      afterBuying,
      afterRefusal,
      afterFabricating,
    };
  });

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
