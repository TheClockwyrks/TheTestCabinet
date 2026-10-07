// build-panel/geometry-stable — nothing the game does moves a panel control.
//
// `specs/hud.md`: "no change in game state adds, removes, resizes, or moves a
// control. A wave starting or ending, Charge accruing or being spent, a
// combinable partner appearing on the yard, and a candidate reaching the top of
// the quality ladder all leave the panel's geometry untouched and change only
// which controls are enabled."
//
// So one structure is selected and every rectangle the inspector reports is
// taken; then each of those four changes is made and the rectangles are taken
// again. Nothing but the state changes themselves happens in between.
//
// WHY THE SELECTION IS RE-ESTABLISHED BEFORE EACH READING. `specs/hud.md` also
// allows the panel's layout to change when the PLAYER causes it, "selecting a
// different structure" among the causes, and nothing fixes what a build selects
// when a rock the player placed lands — selecting the new candidate is an
// ordinary design. Re-selecting the structure under test before each reading
// therefore compares the panel of the same selection each time, which is what
// this requirement is about, and leaves what a placement selects to the points
// that decide it.
//
// The order is the one the rules allow: `specs/scrap-press.md` makes placing a
// rock a build-phase action, so the three build-phase changes happen first and
// the wave starts last.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  holdWaveOpen,
  openYard,
  standCandidate,
  type Harness,
} from "../harness";
import type { PanelButton } from "../surface";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Every reported rectangle, keyed by the slot it belongs to. */
function geometry(buttons: readonly PanelButton[]): string[] {
  return buttons.map(
    (b) => `${b.action} — ${b.label} @ ${b.x},${b.y} ${b.w}x${b.h}`,
  );
}

it("holds every panel rectangle across four changes of game state", async () => {
  await openYard(h, { charge: 0 });
  const selection = await standCandidate(h, "capacitor", 2, 10, 10);

  const panelOf = async (): Promise<string[]> => {
    await h.debug.select(selection);
    return geometry(await h.debug.panelButtons());
  };

  const opening = await panelOf();
  await captureStill(h, "panel");

  // Charge accruing, and then being spent back down.
  await h.debug.setCharge(9_000);
  assertDeepEqual(
    await panelOf(),
    opening,
    "the panel's rectangles once Charge has accrued",
  );
  await h.debug.setCharge(0);
  assertDeepEqual(
    await panelOf(),
    opening,
    "the panel's rectangles once Charge has been spent",
  );

  // A combinable partner appearing on the yard.
  await standCandidate(h, "capacitor", 2, 14, 10);
  assertDeepEqual(
    await panelOf(),
    opening,
    "the panel's rectangles once a combinable partner stands on the yard",
  );

  // A candidate reaching the top of the quality ladder.
  await standCandidate(h, "coil", 5, 18, 10);
  assertDeepEqual(
    await panelOf(),
    opening,
    "the panel's rectangles once a Tesla-Prime candidate stands on the yard",
  );

  // A wave starting.
  await holdWaveOpen(h);
  assertEqual(
    (await h.snapshot()).phase,
    "wave",
    "the phase `setPhase` puts the run into (specs/instrumentation.md)",
  );
  assertDeepEqual(
    await panelOf(),
    opening,
    "the panel's rectangles once the wave has started",
  );
});
