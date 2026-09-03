// assets/ring-model-on-the-slew-axis — the ring model stands centred on the axis
// the arm turns about.
//
// `specs/assets.md` § The models: "The game draws each model wherever its subject
// is: the ring on the slew axis …". `specs/structure.md` fixes where that axis
// is: the ring is placed by its base corner, and the axis runs up through the
// centre of the flange square, half a lattice pitch along each horizontal axis
// from that corner.
//
// SO THE READING IS HORIZONTAL ONLY. Where along the axis the ring sits is the
// build's own business — how tall its bearing drum is, how it sits between its
// flanges — and the specification fixes neither. What it fixes is that the model
// stands ON the axis, which is a fact about `x` and `z`.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertTrue } from "../assert";
import { LATTICE_PITCH } from "../constants";
import {
  clearAll,
  createHarness,
  entriesOf,
  openSite,
  type Harness,
} from "../harness";

/** The ring's base corner, off the ground so `specs/structure.md` accepts it. */
const CORNER = { x: 0, y: 2, z: 0 };

/** The slew axis: the centre of the flange square (`specs/structure.md`). */
const AXIS = {
  x: CORNER.x + LATTICE_PITCH / 2,
  z: CORNER.z + LATTICE_PITCH / 2,
};

/** How far off the axis the model may stand. */
const TOLERANCE = 0.25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the ring model centred on the slew axis", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setScreen("build");
  await h.debug.setRing(CORNER.x, CORNER.y, CORNER.z);
  await h.advance(1);

  const rings = entriesOf(await h.drawn(), "model", "ring");

  await h.capture("ring", "The ring drawn on the slew axis");

  assertTrue(rings.length > 0, "a ring model among what the frame drew");
  assertCloseTo(
    rings[0]!.x,
    AXIS.x,
    TOLERANCE,
    "the ring's drawn x against the slew axis (specs/structure.md)",
  );
  assertCloseTo(
    rings[0]!.z,
    AXIS.z,
    TOLERANCE,
    "the ring's drawn z against the slew axis (specs/structure.md)",
  );
});
