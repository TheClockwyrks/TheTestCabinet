// save/save-pad-writes — activating the Save Pad writes the save on the spot.
//
// specs/expedition.md: "The Save Pad is the only way to save... Activating the pad
// writes the save on the spot", and specs/world.md gives the pad the id
// `save-pad` and says it is the one surface building that opens no panel: it
// saves directly. So a miner standing at it and pressing `activate` leaves
// `hasSave` true with no panel open.
//
// THE PAD IS ASKED WHERE IT IS. specs/world.md fixes only that each building's
// footprint sits on the ground line inside the playable columns, so the layout is
// the build's; the harness reads `buildings()` and centres the miner on the
// footprint it reports.
//
// ISOLATION. An empty mine with the camp's ground laid back as generation leaves
// it, the slot cleared first so the reading is this save rather than an older
// one, and nothing held, carried or installed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import {
  ACTION_KEY,
  captureStill,
  createHarness,
  standAtBuilding,
  type Harness,
} from "../harness";
import { openAtCamp } from "./expedition";

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ storage: true });
});

afterEach(() => {
  h?.dispose();
});

it("saves on the spot at the Save Pad, opening no panel", async () => {
  await openAtCamp(h);

  const empty = h.snapshot();
  assertEqual(
    empty.hasSave,
    false,
    "the slot was cleared before the pad was activated",
  );

  standAtBuilding(h, "save-pad");
  await h.advance(1);
  await h.tap(ACTION_KEY.activate);

  const saved = h.snapshot();
  captureStill(h, "saved");
  assertEqual(
    saved.hasSave,
    true,
    "specs/expedition.md: activating the Save Pad writes the save on the spot",
  );
  assertNull(
    saved.panel,
    "specs/ui.md: the Save Pad has no panel; activating it saves directly",
  );
  assertEqual(
    saved.screen,
    "in-mine",
    "specs/ui.md: saving leaves the game in the mine",
  );
});
