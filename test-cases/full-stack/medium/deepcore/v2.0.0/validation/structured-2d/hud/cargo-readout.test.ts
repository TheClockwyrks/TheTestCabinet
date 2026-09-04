// hud/cargo-readout — the bar states the slots and the load.
//
// `specs/ui.md`: the cargo reads as slots used over capacity with the load in
// kilograms alongside. `specs/mining.md` says the same from the bay's side. All
// three are figures, so all three must be drawn as figures, and the frame's own
// text runs anchored inside the band are read back and searched for them.
//
// The three are taken from the snapshot rather than computed here, because
// `specs/instrumentation.md` requires the snapshot to report the same bay the bar
// shows. A build whose bay is wrong fails its own points in `cargo`; what this
// one decides is whether the bar SAYS what the bay holds.
//
// A known bay is posed and nothing is drilled, so the count is the pose's and not
// something the mine banked. The bay is left part full, so the reading is the
// ordinary one rather than the full-bay alert or the overload, each of which is
// its own point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  layCamp,
  openScene,
  pinDrill,
  stageCargo,
  standAtCamp,
  type Harness,
} from "../harness";
import { barText, numbersOf } from "./bar";

/** A bay part full of one ore, so the three figures are told apart. */
const HELD = { ore: "ferron" as const, count: 13 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("states the slots used, the capacity and the load in kilograms", async () => {
  openScene(h);
  layCamp(h);
  pinDrill(h);
  standAtCamp(h);
  stageCargo(h, { [HELD.ore]: HELD.count });

  const { cargo } = h.snapshot();
  const stated = numbersOf(await barText(h));
  captureStill(h, "cargo");

  assertEqual(stated.has(cargo.slotsUsed), true, "specs/ui.md");
  assertEqual(stated.has(cargo.slotCap), true, "specs/ui.md");
  assertEqual(stated.has(Math.round(cargo.loadKg)), true, "specs/ui.md");
});
