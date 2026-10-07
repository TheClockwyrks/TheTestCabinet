// save/save-holds-the-components — the save carries the installed rocket components.
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
// `world-size/size-carried-in-the-save`; this point decides the installed rocket components alone.
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
import { ROCKET_COMPONENT_IDS } from "../constants";
import { assertDeepEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { bankSave, continueFromTitle, openAtCamp } from "./expedition";

/** Two of the five installed, which no fresh expedition opens with. */
const COMPONENTS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ storage: true });
});

afterEach(() => {
  h?.dispose();
});

it("restores the installed rocket components", async () => {
  await openAtCamp(h);
  h.debug.setRocketInstalled(COMPONENTS);

  bankSave(h);
  await continueFromTitle(h);
  await h.advance(1);
  captureStill(h, "holding");

  assertDeepEqual(
    h.snapshot().rocket.installed,
    ROCKET_COMPONENT_IDS.slice(0, COMPONENTS),
    "specs/expedition.md: the save holds the installed rocket components",
  );
});
