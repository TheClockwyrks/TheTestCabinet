// assets/rocket-stage-follows-progress — the pad shows how far the rocket is.
//
// `specs/assets.md`: the rocket is produced "at each of its six assembly states,
// from the bare pad to the launch-ready rocket, so the player reads the win
// progress from the pad", and `specs/rocket.md` has each fabrication "visibly
// adding that part to the rocket on the pad". So the pad is read at every
// installed count from none to all five, and each has to be drawn differently
// from the one before it.
//
// The pad is found through `buildings()` rather than assumed, because
// `specs/world.md` leaves the camp's layout to the build, and the miner is stood
// at it so the pad is on screen and centred. Only the installed count changes
// between readings — nothing is bought, nothing is fabricated, the miner does not
// move — so a difference is the rocket and nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { ROCKET_COMPONENTS, SURFACE_Y } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  layCamp,
  openScene,
  pinDrill,
  standAtBuilding,
  worldToStage,
  type Harness,
} from "../harness";
import { boxChanged, sampleBox } from "./drawn";
import { ROCKET_STAGES } from "./spec";

/** How far above the pad's footprint the reading reaches, in world units. */
const HEADROOM = 160;

/** The count the still is taken at: partway up the checklist. */
const SHOWN = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ assets: true });
});

afterEach(() => {
  h?.dispose();
});

it("draws a different rocket at every installed count", async () => {
  openScene(h);
  layCamp(h);
  pinDrill(h);
  const pad = standAtBuilding(h, "launch-pad");
  h.debug.setPanel(null);
  await h.advance(2);

  const snapshot = h.snapshot();
  const top = worldToStage(snapshot, pad.x, pad.y - HEADROOM);
  const box = { x: top.x, y: top.y, w: pad.w, h: pad.h + HEADROOM };

  const readings: number[][] = [];
  for (let installed = 0; installed < ROCKET_STAGES; installed += 1) {
    h.debug.setRocketInstalled(installed);
    await h.advance(1);
    readings.push(sampleBox(h, box));
    if (installed === SHOWN) captureStill(h, "pad");
  }

  const same: string[] = [];
  for (let at = 1; at < readings.length; at += 1) {
    if (boxChanged(readings[at - 1], readings[at]) === 0) {
      same.push(`${at - 1} and ${at}`);
    }
  }

  assertEqual(ROCKET_STAGES, ROCKET_COMPONENTS.length + 1, "specs/rocket.md");
  assertEqual(SURFACE_Y > 0, true, "specs/world.md");
  assertEqual(same.join(", "), "", "specs/assets.md");
});
