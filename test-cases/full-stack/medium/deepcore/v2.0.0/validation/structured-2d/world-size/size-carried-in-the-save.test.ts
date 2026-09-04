// world-size/size-carried-in-the-save — the chosen size is written into the save
// and comes back with it.
//
// specs/world.md: "The chosen size is part of the expedition, so it is carried in
// the save and reused when an expedition is replayed", and specs/expedition.md
// lists "the generated mine and its world size" among what a save holds. So a
// Marathon expedition saved and continued resumes at Marathon, with `coreRow`
// back at 1000, rather than reverting to the Standard size a fresh session opens
// at.
//
// WHY MARATHON. `standard` is what `reset` restores and what a build that dropped
// the size from the save would fall back to, so a save taken at any other size
// tells the two apart; Marathon is the furthest from it.
//
// ISOLATION. A Marathon expedition on an empty mine with the slot cleared first,
// the miner standing at the camp where saving is allowed, and nothing else. The
// save is written through the control that stands for the Save Pad and restored
// through the title's `CONTINUE`, which specs/ui.md fixes as that menu's first
// item while a save exists.

import { afterEach, beforeEach, it } from "vitest";
import { CORE_COL } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  coreRowFor,
  createHarness,
  type Harness,
} from "../harness";
import { bankSave, continueFromTitle, openAtCamp } from "../save/expedition";

/** The size the save is taken at: the one furthest from the session default. */
const SIZE = "marathon" as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ storage: true });
});

afterEach(() => {
  h?.dispose();
});

it("restores a Marathon expedition at Marathon rather than at Standard", async () => {
  await openAtCamp(h, { size: SIZE });
  bankSave(h);

  await continueFromTitle(h);
  await h.advance(1);

  const resumed = h.snapshot();
  captureStill(h, "size");
  assertEqual(
    resumed.screen,
    "in-mine",
    "specs/ui.md: CONTINUE resumes the save into in-mine",
  );
  assertEqual(
    resumed.worldSize,
    SIZE,
    "specs/world.md: the world size is carried in the save",
  );
  assertEqual(
    resumed.coreRow,
    coreRowFor(SIZE),
    "specs/world.md: coreRow comes back with the restored size",
  );
  assertEqual(
    h.tileAt(CORE_COL, coreRowFor(SIZE)).kind,
    "core",
    "specs/world.md: the restored mine is as deep as its size says",
  );
});
