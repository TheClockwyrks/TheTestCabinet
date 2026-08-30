// pathing/no-recompute-midwave — a wave walks the maze it started with.
//
// `specs/pathing.md` puts it plainly: nothing available during a live wave
// changes a tile's state. `specs/campaign.md` lists what IS available then —
// refining the press, upgrading a combination tower, and changing a targeting
// priority — and `specs/scrap-press.md` keeps building itself out of the wave
// entirely. So the three mid-wave actions are exactly the ones that must leave
// the route alone, and they are the three taken here.
//
// WHAT A FAILURE COSTS THE PLAYER. A route that moves under a walking Load is a
// wave that behaves differently from the one the player built for, and it does it
// in response to an action that has nothing to do with the yard. Refining the
// press cannot be allowed to reroute the Load.

import { afterEach, beforeEach, it } from "vitest";

import { TARGETING_PRIORITIES } from "../../src/constants";
import { assertCloseTo, assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  openYard,
  standCombo,
  standComponent,
  startWave,
  type Harness,
} from "../harness";

/** Charge enough for a refinement and a tower upgrade, so neither is refused. */
const CHARGE = 5000;

/** Where the three structures the mid-wave actions act on stand. */
const TOWER_AT = { col: 20, row: 10 };
const COMPONENT_AT = { col: 24, row: 10 };
const HARVEST_AT = { col: 28, row: 10 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the maze length untouched across every mid-wave action", async () => {
  openYard(h, { charge: CHARGE, refinement: 0 });

  const tower = standCombo(h, "nullcore", TOWER_AT.col, TOWER_AT.row);
  const component = standComponent(
    h,
    "capacitor",
    1,
    COMPONENT_AT.col,
    COMPONENT_AT.row,
  );
  // The level's harvest is what starts the wave; there is no send control.
  startWave(h, "capacitor", 1, HARVEST_AT.col, HARVEST_AT.row);
  await h.advance(1);

  const started = h.snapshot();
  assertEqual(started.phase, "wave", "the phase the harvest launched");
  const opening = started.mazeLength;

  const readings = await captureReplay(h, "unchanged", async () => {
    const taken: { action: string; mazeLength: number }[] = [];
    const record = async (action: string): Promise<void> => {
      await h.advance(30);
      taken.push({ action, mazeLength: h.snapshot().mazeLength });
    };

    h.debug.upgradeQuality();
    await record("refining the press");

    h.debug.upgradeCombo(tower);
    await record("upgrading a combination tower");

    h.debug.setTargeting(component, TARGETING_PRIORITIES[2]!);
    await record("cycling a targeting priority");

    return taken;
  });

  for (const reading of readings) {
    assertCloseTo(
      reading.mazeLength,
      opening,
      6,
      `the maze length after ${reading.action} during a live wave, against ` +
        `the ${opening} the wave started on`,
    );
  }
});
