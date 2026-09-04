// audio/lava-sizzle-cue — touching lava sounds the sizzle.
//
// `specs/assets.md`: the `lava-sizzle` cue plays when the miner touches lava.
// `specs/hazards.md` fixes what touching is — the miner's box overlapping a lava
// cell, which drains hull at `LAVA_CONTACT_DPS` for as long as it lasts — so the
// contact is posed by turning the cell the miner's box already occupies to lava,
// and the hull falling is what says the contact is real.
//
// A silent window is measured first over the same standing miner, so the cue
// belongs to the contact rather than to anything the scene was already doing, and
// the cue is read BY NAME off the engine's bus so nothing else the scene sounds can
// stand in for it. The hull tier is raised so the drain does not empty it inside
// the window, the radiator is left at tier 1 where `specs/upgrades.md` gives it no
// effect, and both hazard notices are marked fired so no card is raised over the
// reading.

import { afterEach, beforeEach, it } from "vitest";
import { CUES, PLAYABLE_COL_MIN } from "../../src/constants";
import { assertEqual, assertLessThan } from "../assert";
import {
  captureReplay,
  createHarness,
  layFloor,
  openScene,
  pinDrill,
  pinMiner,
  stageTiers,
  standOn,
  type Harness,
} from "../harness";
import { audibleOver, watchAudio } from "./cues";

/** A deepstone row, the shallowest band `specs/world.md` puts lava in. */
const ROW = 300;
const COL = PLAYABLE_COL_MIN + 8;

/** Each window, in seconds, and the frames it is driven in. */
const WINDOW = 1;
const FRAMES = 120;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sounds the sizzle while the miner is in lava and not before", async () => {
  openScene(h);
  stageTiers(h, { hull: 5 });
  pinDrill(h);
  layFloor(h, ROW);
  standOn(h, COL, ROW);
  pinMiner(h);
  h.debug.setNoticeFired("gas", true);
  h.debug.setNoticeFired("lava", true);

  const log = watchAudio(h);
  const heard = await captureReplay(h, "sizzle", async () => {
    const before = await audibleOver(h, log, CUES.lavaSizzle, WINDOW, FRAMES);
    const dry = h.snapshot();
    // The cell the miner's box already stands in, so the contact is the pose.
    h.debug.setTile(COL, ROW - 1, "lava");
    const during = await audibleOver(h, log, CUES.lavaSizzle, WINDOW, FRAMES);
    return { before, during, dry, wet: h.snapshot() };
  });

  assertLessThan(
    heard.wet.miner.hull,
    heard.dry.miner.hull,
    "specs/hazards.md",
  );
  assertEqual(heard.before, false, "specs/assets.md");
  assertEqual(heard.during, true, "specs/assets.md");
});
