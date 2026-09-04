// load/roster-speed — each Load type travels at the speed its roster row gives.
//
// `specs/enemies.md`'s roster fixes a speed per type, in logical units a second: a
// Mote at `60`, a Spark at `120`, a Slug at `38`, a Cluster at `72`, a Filament at
// `85` and a Dynamo at `30`.
//
// BOTH FIGURES THE SNAPSHOT CARRIES ARE READ, off a unit that is TRAVELLING,
// because the roster's speed is what a unit moves at and a unit that has been held
// is not one that is moving. `baseSpeed` is "the roster speed" and `speed` is "the
// current speed, after any slow" (`specs/instrumentation.md`), and a unit carrying
// no slow reads its roster speed on both.
//
// The four figures the roster fixes are read four ways, and each is a point of
// its own: a build that pays the wrong bounty and walks every type at the right
// speed has to grade differently from one that gets both wrong. `specs/enemies.md`
// holds all four in one table, and `constants.ts` transcribes it.
//
// TWO OF THE FOUR ARE READ AND TWO ARE DRIVEN. `speed` and `flying` are on the
// snapshot. A bounty and a leak value are not reported anywhere:
// `specs/economy.md` defines each as what an event pays or costs, so the event is
// driven and the change it made is read on the frame the unit was removed.
//
// The field `load/vitals.ts` poses is what makes either reading a verdict: one
// Capacitor, no refinement, no upgrade, and the wave's own clear-and-pay
// resolution held, so nothing but the unit being read can move either counter. The
// fifth roster figure, base health, is the one the per-wave scaling multiplies, and
// it has three checks of its own.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { LOAD_ROSTER } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { leakFor, openField, walkOne } from "./vitals";

/** Comfortably above the eleven Grid Integrity the six walks below cost. */
const INTEGRITY = 200;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("moves each roster type at its roster speed", async () => {
  openField(h, { wave: 1, integrity: INTEGRITY });

  const rows = [];
  for (const def of LOAD_ROSTER) rows.push(await leakFor(h, def.type));

  // A still of one type on the same walk every reading above was taken off.
  openField(h, { wave: 1, integrity: INTEGRITY });
  walkOne(h, LOAD_ROSTER[0]!.type);
  await h.advance(1);
  captureStill(h, "speed");

  for (const [index, def] of LOAD_ROSTER.entries()) {
    assertCloseTo(
      rows[index]!.baseSpeed,
      def.speed,
      6,
      `a ${def.type}'s roster speed`,
    );
    assertCloseTo(
      rows[index]!.speed,
      def.speed,
      6,
      `a ${def.type} carrying no slow moves at its roster speed`,
    );
  }
});
