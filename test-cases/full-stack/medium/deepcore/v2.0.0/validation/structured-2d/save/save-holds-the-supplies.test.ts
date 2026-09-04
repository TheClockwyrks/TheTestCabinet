// save/save-holds-the-supplies — the save carries the held field-supply counts.
//
// specs/expedition.md: "A save holds the generated mine and its world size, the
// mode, banked Credits, every upgrade tier, the installed rocket components, the
// held field-supply counts, the cargo, the satchel's materials, and the miner's
// fuel and hull."
//
// ONE HOLDING PER POINT. That sentence lists ten things a save carries, and a
// point that asserted all of them could only fail once — a build whose save drops
// one field would be docked exactly as much as one whose save persists nothing.
// The mine and the size are `save/save-holds-the-mine` and
// `world-size/size-carried-in-the-save`; this point decides the six field-supply counts alone, one reading each.
//
// THE VALUE IS DISTINCTIVE. It is posed away from both the value a fresh
// expedition opens at and the value a `reset` restores, so a build that dropped
// the field from the save and rebuilt it from the defaults reads back wrong
// rather than reading back right by coincidence.
//
// ISOLATION. One expedition on an empty mine with the slot cleared first, the
// miner standing at the camp where saving is allowed, no Core Sample live, and
// nothing driven: the holding is posed, the save is written through the control
// that stands for the Save Pad, and the restore is the title's `CONTINUE`.

import { afterEach, beforeEach, it } from "vitest";
import { ITEM_IDS, type ItemId } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  stageItems,
  type Harness,
} from "../harness";
import { bankSave, continueFromTitle, openAtCamp } from "./expedition";

/** A count for every supply, all of them away from the zero a session opens at. */
const ITEMS: Record<ItemId, number> = {
  dynamite: 3,
  "plastic-explosives": 1,
  "quantum-teleporter": 4,
  "matter-transmitter": 2,
  nanobots: 5,
  "emergency-fuel": 6,
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ storage: true });
});

afterEach(() => {
  h?.dispose();
});

it("restores the held field-supply counts", async () => {
  await openAtCamp(h);
  stageItems(h, ITEMS);

  bankSave(h);
  await continueFromTitle(h);
  await h.advance(1);
  captureStill(h, "holding");

  const restored = h.snapshot();
  for (const item of ITEM_IDS) {
    assertEqual(
      restored.items[item],
      ITEMS[item],
      `specs/expedition.md: the save holds the ${item} count`,
    );
  }
});
