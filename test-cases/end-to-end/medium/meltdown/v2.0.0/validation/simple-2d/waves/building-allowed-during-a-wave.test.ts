// waves/building-allowed-during-a-wave — the floor can be built on while a wave
// is running.
//
// specs/waves.md, The three phases: "Placing, upgrading, and selling are allowed in
// all three." This point reads the placing half of that on the phase where a build
// is most likely to have forbidden it: the `wave` phase, with the wave still
// releasing.
//
// THE PLACEMENT IS THE PLAYER'S. `addTower` is the atom that poses a floor and
// "runs no placement check" (specs/instrumentation.md), so it could never answer
// this; what is driven instead is the act — arm a type, carry the preview onto a
// tile, and `place()`, which "commits the held preview at its current footprint if
// `build.valid` is true, exactly as a pointer press on the floor does".
//
// `build.valid` IS READ AS THE PRECONDITION AND THE PLACEMENT AS THE POINT.
// specs/building.md lists the six conditions a footprint must satisfy, and every
// one of them holds here: the tile is on the grid and open, no unit stands on it,
// the run holds far more than an Arc's `15`, Containment fixes no build zone, and a
// single 2x2 on open floor seals nothing. So a build that reports the preview
// invalid in the `wave` phase has already answered this point, and the failure says
// which of the two it got wrong.
//
// THE FLOOR IS EMPTY OF SURGE AND THE WORLD GATE IS SHUT, which is the isolation.
// specs/building.md's third condition invalidates a footprint on "the tile a surge
// unit's centre occupies", so a unit wandering onto the site would refuse the
// placement for a reason that has nothing to do with the phase. `wavePending` is
// posed instead: the wave has units still to come, so it is genuinely in progress
// and cannot clear underneath the reading, and the gate holds the spawner from
// releasing them (specs/instrumentation.md).
//
// WHAT EVERY WRONG MODEL READS. A build that allows building only between waves
// reports `build.valid` false, or places nothing; a build that allows it but
// forgets the wave is running clears the wave and is caught by the phase
// precondition.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  lastTower,
  startRun,
  type Harness,
} from "../harness";

/** The type built: the cheapest emitter (specs/towers.md gives the Arc a cost of 15). */
const TYPE = "arc";

/** The site: open floor, clear of both straight vent-to-exhaust corridors. */
const SITE = { col: 10, row: 10 } as const;

/** Units still to release, so the wave is genuinely in progress. */
const PENDING = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("places a tower while the phase is wave", async () => {
  startRun(h);
  h.debug.setPhase("wave");
  h.debug.setWavePending(PENDING);

  h.debug.setArmed(TYPE);
  h.debug.setPreview(SITE.col, SITE.row);
  const held = h.snapshot().build;
  assertTrue(
    held !== null && held.valid,
    "precondition: the held preview reported itself placeable mid-wave",
  );

  h.debug.place();
  await h.advance(1);

  const built = h.snapshot();
  captureStill(h, "built");

  assertEqual(built.phase, "wave", "precondition: the phase was still wave");
  assertEqual(
    built.towers.length,
    1,
    "the towers standing after the placement",
  );
  const tower = lastTower(built);
  assertEqual(tower.type, TYPE, "the type the placement built");
  assertEqual(tower.col, SITE.col, "the column the placement built on");
  assertEqual(tower.row, SITE.row, "the row the placement built on");
});
