// panels/panel-opens-at-a-building — activating at a building opens its panel.
//
// `specs/ui.md`: each of the five panelled buildings opens its panel when the
// miner activates it, and `specs/world.md` names the six buildings and their ids.
// The Save Pad is the sixth and has no panel, which is its own point.
//
// Reached the way `specs/controls.md` fixes it and no other way: the miner is
// stood on the camp ground centred on the footprint the build reports through
// `buildings()`, and `activate` is pressed. Where the six sit is the build's, so
// the footprint is asked for rather than assumed. The drill is held, because
// nothing here cuts; travel runs, because standing at a building is travel's
// business.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import type { Panel } from "../constants";
import {
  ACTION_KEY,
  captureStill,
  createHarness,
  layCamp,
  openScene,
  pinDrill,
  standAtBuilding,
  type Harness,
} from "../harness";

/** The five buildings that carry a panel, each with the panel it opens. */
const PANELLED: readonly { building: string; panel: Panel }[] = [
  { building: "fuel-depot", panel: "fuel-depot" },
  { building: "ore-market", panel: "ore-market" },
  { building: "upgrade-shop", panel: "upgrade-shop" },
  { building: "supply-depot", panel: "supply-depot" },
  { building: "launch-pad", panel: "launch-pad" },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens each of the five building panels from its building", async () => {
  await openScene(h);
  await layCamp(h);
  await pinDrill(h);

  const opened: string[] = [];
  for (const { building, panel } of PANELLED) {
    await h.debug.setPanel(null);
    await standAtBuilding(h, building);
    await h.tap(ACTION_KEY.activate);
    opened.push(String((await h.snapshot()).panel));
    if (panel === "ore-market") await captureStill(h, "panel");
  }

  assertEqual(
    opened.join(", "),
    PANELLED.map(({ panel }) => panel).join(", "),
    "specs/ui.md",
  );
});
