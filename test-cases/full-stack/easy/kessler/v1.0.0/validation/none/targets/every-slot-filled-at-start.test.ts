// targets/every-slot-filled-at-start — a fresh session lays out 12 + 16 + 20
// targets, each at its ring's full hit points.
//
// WHAT THE SPECIFICATION FIXES. specs/rings.md: "Every slot is filled at the
// start of a wave.", with the table giving 12, 16, and 20 slots and full hit
// points of 1, 2, and 1 for rings 1 to 3, and "A session starts at wave `1`".
//
// THE ROUTE IS THE HARNESS'S OWN SESSION START: the sequence of atomic poses
// that begins a session the way confirming START begins one, so no menu stands
// between the check and the layout it reads — a build with a broken title and a
// correct wave layout fails the navigation points and passes this one.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  openHarness,
  startFreshSession,
  type Harness,
} from "../harness";
import { figures } from "./rig";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fills every slot of all three rings at full hit points", async () => {
  const snap = await startFreshSession(h);
  await h.tick(1);
  await captureStill(h, "field");

  assertEqual(snap.wave, 1, "a fresh session's wave");
  for (const ring of [1, 2, 3]) {
    const fig = figures(ring);
    const targets = snap.rings[ring - 1]?.targets ?? [];
    assertLength(targets, fig.slots, `ring ${ring} fills every slot`);
    const slots = targets.map((t) => t.slot).sort((a, b) => a - b);
    assertDeepEqual(
      slots,
      Array.from({ length: fig.slots }, (_, k) => k),
      `ring ${ring} holds one target in each of slots 0..${fig.slots - 1}`,
    );
    for (const target of targets) {
      assertEqual(
        target.hp,
        fig.fullHp,
        `ring ${ring} slot ${target.slot} starts at full hit points`,
      );
    }
  }
});
