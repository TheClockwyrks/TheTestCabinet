// building/place-stays-armed — one arming lays a run of copies.
//
// specs/building.md, Placing: "Placement stays armed afterward, at the same type
// and the same rotation, so a second copy drops without arming again."
//
// NOTHING RE-ARMS. The type is armed once and the rotation held once, and from
// there each copy is one `setPreview` and one `place`. That is what makes this a
// reading about staying armed rather than about arming: a build that dropped the
// held type after the first commit leaves `build` null and the second copy never
// lands.
//
// THE ROTATION HELD IS 2, so a build that quietly re-armed — which returns the held
// rotation to 0 (specs/building.md, Arming a type) — reads a different rotation
// rather than merely a non-null preview, and the failure names which of the two it
// did.
//
// THE PURSE IS FAR ABOVE THREE COPIES' COST, so the one disarm the specification
// does state — the money left falling below the type's cost — is nowhere near, and
// `building/place-disarms-when-unaffordable` is what decides that one.
//
// The three anchors are quiet anchors from `fixtures.ts`, six tiles apart, so no
// copy's footprint touches another's and none of them lengthens a route.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { TOWER_DEFS } from "../constants";
import { freeSite } from "../fixtures";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { heldPreview } from "./preview";

/** The type armed once, and the rotation held once. */
const HELD = "arc";
const ROTATION = 2;

/** Three quiet anchors, none touching another. */
const SPOTS = [freeSite(0), freeSite(1), freeSite(2)];

/** Far above the three copies' cost, so no copy is ever unaffordable. */
const PURSE = 20 * TOWER_DEFS[HELD].cost;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("stays armed at the same type and rotation across a run of copies", async () => {
  await startRun(h);
  await h.debug.setMoney(PURSE);

  await h.debug.setArmed(HELD);
  await h.debug.setPreviewRotation(ROTATION);

  for (const [index, spot] of SPOTS.entries()) {
    await h.debug.setPreview(spot.col, spot.row);
    await h.debug.place();

    const build = await heldPreview(h);
    const nth = `after copy ${index + 1} of ${SPOTS.length}`;
    assertEqual(build.type, HELD, `${nth}: the type still held`);
    assertEqual(build.rotation, ROTATION, `${nth}: the rotation still held`);
  }

  const towers = (await h.snapshot()).towers;

  await h.advance(1);
  await captureStill(h, "armed");

  assertLength(towers, SPOTS.length, "the copies one arming laid");
});
