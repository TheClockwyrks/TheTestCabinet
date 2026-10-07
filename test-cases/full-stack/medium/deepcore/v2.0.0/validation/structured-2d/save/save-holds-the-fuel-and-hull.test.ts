// save/save-holds-the-fuel-and-hull — the save carries the fuel and hull the miner climbed out with.
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
// `world-size/size-carried-in-the-save`; this point decides the miner's fuel and hull, which are one reading taken twice: both are
// the same rule, a gauge carried across the save rather than refilled by it.
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
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { bankSave, continueFromTitle, openAtCamp } from "./expedition";

/**
 * A part-spent tank and a damaged hull, both inside the tier-1 maxima so the
 * figures are the save's rather than a clamp's, and both away from the full
 * gauges a fresh expedition opens with.
 */
const FUEL = 37;
const HULL = 61;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ storage: true });
});

afterEach(() => {
  h?.dispose();
});

it("restores the fuel and the hull the miner climbed out with", async () => {
  await openAtCamp(h);
  h.debug.setFuel(FUEL);
  h.debug.setHull(HULL);

  bankSave(h);
  await continueFromTitle(h);
  await h.advance(1);
  captureStill(h, "holding");

  const restored = h.snapshot();
  assertEqual(
    restored.miner.fuel,
    FUEL,
    "specs/expedition.md: the save holds the fuel the miner climbed out with",
  );
  assertEqual(
    restored.miner.hull,
    HULL,
    "specs/expedition.md: the save holds the hull the miner climbed out with",
  );
});
