// hud/effects-indicated — while a timed effect is in force the HUD indicates
// it.
//
// specs/screens.md, the HUD table: "Effects — The active effects", and below
// it: "The effects readout indicates each timed effect currently in force and
// whether a shield is active. It may reuse the produced pod sprites". No
// glyphs or layout are fixed, so the reading is differential — the frame must
// change when the effect comes into force — with frame-to-frame animation
// subtracted by a same-value baseline pair.
//
// PIERCE IS THE EFFECT POSED, deliberately: widen and narrow change the
// deflector's span (a change of the deflector itself, not of the HUD), while
// pierce dresses only the balls, and the isolated field holds none. Evidence
// is confined to the stage outside radius 230 — beyond the planet (70), the
// shield ring (contact 100), and the deflector's track and catch radii (up to
// 196) — so a build that merely tints the deflector for pierce, and never
// tells the player through the HUD, does not pass on that tint.

import { afterEach, beforeEach, it } from "vitest";
import { PIERCE_TICKS } from "../constants";
import { captureStill, isolate, openHarness, type Harness } from "../harness";
import { assertReadoutChanged, keepOutside, readFrame } from "./readouts";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("indicates a timed effect in force", async () => {
  await isolate(h);
  const base = await readFrame(h);
  const again = await readFrame(h);

  await h.debug.setEffectTicks("pierce", PIERCE_TICKS);
  const changed = await readFrame(h);
  await captureStill(h, "effect");

  assertReadoutChanged(
    base,
    again,
    changed,
    keepOutside(h, 230),
    "the HUD indicating the pierce effect in force (a stable change outside the deflector's own dressing)",
  );
});
