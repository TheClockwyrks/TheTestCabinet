// audio/lava-sizzle-cue — touching lava sounds.
//
// `specs/assets.md`: the `lava-sizzle` cue plays when the miner touches lava.
// `specs/hazards.md` fixes what touching is — the miner's box overlapping a lava
// cell, which drains hull at `LAVA_CONTACT_DPS` for as long as it lasts — so the
// contact is posed by turning the cell the miner's box already occupies to lava,
// and the hull falling is what says the contact is real.
//
// A silent window is measured first over the same standing miner, so the sound
// belongs to the contact rather than to anything the scene was already doing. The
// hull tier is raised so the drain does not empty it inside the window, the
// radiator is left at tier 1 where `specs/upgrades.md` gives it no effect, and
// both hazard notices are marked fired so no card is raised over the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import { PLAYABLE_COL_MIN } from "../constants";
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
import { armAudio, soundsOver } from "./probe";

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

afterEach(async () => {
  await h.dispose();
});

it("sounds while the miner is in lava and not before", async () => {
  const armed = await armAudio(h);
  await openScene(h);
  await stageTiers(h, { hull: 5 });
  await pinDrill(h);
  await layFloor(h, ROW);
  await standOn(h, COL, ROW);
  await pinMiner(h);
  await h.debug.setNoticeFired("gas", true);
  await h.debug.setNoticeFired("lava", true);

  const heard = await captureReplay(h, "sizzle", async () => {
    const before = await soundsOver(h, WINDOW, FRAMES);
    const dry = await h.snapshot();
    // The cell the miner's box already stands in, so the contact is the pose.
    await h.debug.setTile(COL, ROW - 1, "lava");
    const during = await soundsOver(h, WINDOW, FRAMES);
    return { before, during, dry, wet: await h.snapshot() };
  });

  assertEqual(armed, true, "specs/assets.md");
  assertLessThan(
    heard.wet.miner.hull,
    heard.dry.miner.hull,
    "specs/hazards.md",
  );
  assertEqual(heard.before, 0, "specs/assets.md");
  assertGreaterThan(heard.during, 0, "specs/assets.md");
});
