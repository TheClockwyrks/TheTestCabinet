// hud/shield-indicated — while a shield is active the HUD indicates it.
//
// specs/screens.md, on the effects readout: it "indicates each timed effect
// currently in force and whether a shield is active". No glyphs or layout are
// fixed, so the reading is differential — the frame must change when the
// shield comes up — with frame-to-frame animation subtracted by a same-value
// baseline pair.
//
// The shield ALSO draws its own ring: "the shield ring around the planet,
// drawn at the radius" 92 (specs/pods.md), which the visibility item
// shield-drawn-while-active reads. That ring is not the HUD, so evidence here
// is confined to the stage outside radius 150 — clear of the ring and its
// contact radius 100 with margin — and a build that draws the ring but never
// tells the player through the HUD does not pass on the ring.

import { afterEach, beforeEach, it } from "vitest";
import { captureStill, isolate, openHarness, type Harness } from "../harness";
import { assertReadoutChanged, keepOutside, readFrame } from "./readouts";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("indicates an active shield", async () => {
  await isolate(h);
  const base = await readFrame(h);
  const again = await readFrame(h);

  await h.debug.setShield(true);
  const changed = await readFrame(h);
  await captureStill(h, "shield");

  assertReadoutChanged(
    base,
    again,
    changed,
    keepOutside(h, 150),
    "the HUD indicating the active shield (a stable change outside the shield ring's own drawing)",
  );
});
