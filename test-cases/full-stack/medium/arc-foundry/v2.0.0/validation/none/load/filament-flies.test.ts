// load/filament-flies — the Filament is the roster's one flyer.
//
// specs/enemies.md's roster gives a `Flies` column, and exactly one row in it
// reads yes: "Filament — The flyer. It ignores the maze and flies the
// straight-line chain." The other five walk. specs/instrumentation.md reports the
// bit on every unit as `flying`, so the whole roster is read at once.
//
// Both directions are read, on the same yard: the Filament reports `true`, and
// each of the other five reports `false`. What a flyer then DOES — flying the
// straight line over every wall rather than walking the maze — is the pathing
// checks' business; this one decides only which unit is the one that does it.
//
// Every unit is released frozen onto an empty yard, so the reading is of six
// units that arrived and nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { LOAD_ROSTER } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  releaseUnit,
  unitById,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports flying on the Filament alone", async () => {
  await openYard(h, { wave: 1 });

  const released = new Map<string, number>();
  for (const def of LOAD_ROSTER) {
    released.set(def.type, await releaseUnit(h, def.type, { frozen: true }));
  }

  await h.advance(1);
  await captureStill(h, "roster");

  const s = await h.snapshot();
  for (const def of LOAD_ROSTER) {
    assertEqual(
      unitById(s, released.get(def.type)!).flying,
      def.flying,
      `the ${def.type} ${def.flying ? "flies" : "walks"}`,
    );
  }
});
