// panels/clicking-a-building-activates-it — the mouse opens a building.
//
// `specs/controls.md`: clicking a surface building activates it, exactly as
// `activate` does while standing at it. So the miner is stood at the building and
// the building is CLICKED; `activate` is never pressed, so the panel that opens
// is the click's doing and nothing else's.
//
// Where the building is drawn follows from `specs/world.md` alone: `buildings()`
// reports the footprint in world units, and `worldToStage` maps its middle
// through the camera the snapshot reports. A frame runs first so the camera has
// settled on the miner before the point is computed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  layCamp,
  openScene,
  pinDrill,
  standAtBuilding,
  worldToStage,
  type Harness,
} from "../harness";
import { clickStage } from "./mouse";

/** The building the click is aimed at. */
const BUILDING = "ore-market";

/** Frames the clip runs on after the reading, so it shows the panel it opened. */
const SETTLE = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens a building's panel from a click on the building", async () => {
  await openScene(h);
  await layCamp(h);
  await pinDrill(h);
  const box = await standAtBuilding(h, BUILDING);
  await h.debug.setPanel(null);
  await h.advance(2);

  const panel = await captureReplay(h, "click", async () => {
    const snapshot = await h.snapshot();
    const at = worldToStage(snapshot, box.x + box.w / 2, box.y + box.h / 2);
    await clickStage(h, at.x, at.y);
    await h.advance(2);
    const opened = (await h.snapshot()).panel;
    await h.advance(SETTLE);
    return opened;
  });

  assertEqual(panel, BUILDING, "specs/controls.md");
});
