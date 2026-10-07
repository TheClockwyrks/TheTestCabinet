// save/save-holds-the-cargo — the save carries the cargo in the bay.
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
// `world-size/size-carried-in-the-save`; this point decides the cargo alone.
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
import { assertDeepEqual } from "../assert";
import { type Ore } from "../constants";
import {
  captureStill,
  createHarness,
  stageCargo,
  type Harness,
} from "../harness";
import { bankSave, continueFromTitle, openAtCamp } from "./expedition";

/** A part-full bay of three ores, which no fresh expedition opens with. */
const CARGO: Partial<Record<Ore, number>> = {
  ferron: 4,
  cobaltine: 2,
  roselite: 1,
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("restores the cargo in the bay", async () => {
  await openAtCamp(h);
  await stageCargo(h, CARGO);

  await bankSave(h);
  await continueFromTitle(h);
  await h.advance(1);
  await captureStill(h, "holding");

  assertDeepEqual(
    (await h.snapshot()).cargo.ore,
    CARGO,
    "specs/expedition.md: the save holds the cargo",
  );
});
