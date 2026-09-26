// Deepcore — core-run/core-is-inexhaustible: the Core survives being drilled.
//
// `specs/world.md` on the `core` tile: "Drilling downward onto it extracts a Core
// Sample and leaves the tile in place." `specs/mining.md` says what that buys the
// player: "The Core is inexhaustible: drilling it never removes it, so another
// Core Sample is always available", and `specs/hazards.md` closes the loop —
// "Because the Core is inexhaustible, a lost Sample always means another trip
// down rather than an unwinnable expedition."
//
// So a Sample is extracted, the cell is read back as still the Core, the Sample
// is taken away as a death or a detonation would take it, and a second
// extraction is driven from the same cell. Both halves are the one requirement:
// the tile standing, and a second Sample really coming out of it.
//
// The Sample is removed through `setCoreCarried(false)`, which
// `specs/instrumentation.md` says removes it "without detonating it" — the loss
// this check needs, with none of the blast that a run-out timer would add.

import { afterEach, beforeEach, it } from "vitest";
import { CORE_COL } from "../constants";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  openScene,
  type Harness,
} from "../harness";
import { extractSample, standOnCore } from "./core-scene";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the Core in place and yields a second Sample", async () => {
  openScene(h);
  const posed = standOnCore(h);
  const core = { col: CORE_COL, row: posed.coreRow };

  const run = await captureReplay(h, "core", async () => {
    const first = await extractSample(h);
    const afterFirst = h.tileAt(core.col, core.row);

    // Lose the Sample the way a death or a detonation loses it, with no blast.
    h.debug.setCoreCarried(false);
    const second = await extractSample(h);
    const afterSecond = h.tileAt(core.col, core.row);

    return { first, afterFirst, second, afterSecond };
  });

  assertEqual(run.first.taken, true, "a Sample from the first extraction");
  assertEqual(
    run.afterFirst.kind,
    "core",
    "the Core cell after one extraction",
  );

  assertEqual(run.second.taken, true, "a Sample from a second extraction");
  assertEqual(
    run.afterSecond.kind,
    "core",
    "the Core cell after two extractions",
  );
});
