// Wick — evolutions/pyre-both-sides: Pyre slashes both sides on every firing.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Pyre"): "Pyre is
// Taper's slash on both sides of the player on every firing: two rectangles of
// `width × height`, one extending `width` in the facing direction from the
// player's `x` and one mirrored to the opposite side, each centered vertically
// on the player's `y`, each hitting on the tick it fires alone", with `width`
// `200` and `height` `60` from `PYRE_STATS` and `areaMul` `1` with no passive
// held. So with the lamplighter at the origin facing right, the two rectangles
// span `x` from `0` to `200` and from `-200` to `0`, both `y` from `-30` to
// `30`. A moth at `(100, 0)` lies inside the first and one at `(-100, 0)`
// inside the second, and the firing tick hits both: Pyre's damage of `60` takes
// a moth's `5` hp (`specs/enemies.md`, unscaled at a run clock of `0`) past `0`,
// so a moth the slash reached is gone and a moth it missed stands at `5`.
//
// THE POSE. An isolated night, facing posed right, one moth on each side, and
// Pyre held at level 1 fired through the shared `fireWeapon`. `enemyMotion` and
// `enemyContact` are off, so each moth stands where it was posed and lands
// nothing back. A build that slashes only the facing side leaves the moth
// behind the lamplighter standing, which is what this point reads.
//
// TOLERANCE. None: each moth is either gone or standing at its posed hp.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  fireWeapon,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";
import { MOTH_HP, assertHit } from "./stage";

/** The probe on the facing side: inside the `0`-to-`200` rectangle. */
const AHEAD = { x: 100, y: 0 };

/** The probe on the mirrored side: inside the `-200`-to-`0` rectangle. */
const BEHIND = { x: -100, y: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("hits a moth on each side of the lamplighter on the same Pyre firing tick", async () => {
  const opened = await isolate(h);
  await h.debug.setFacing("right");
  const at = opened.run.player;
  const ahead = await placeEnemy(h, "moth", at.x + AHEAD.x, at.y + AHEAD.y);
  const behind = await placeEnemy(h, "moth", at.x + BEHIND.x, at.y + BEHIND.y);
  assertEqual(ahead.hp, MOTH_HP, "the facing-side moth's hp as posed");
  assertEqual(behind.hp, MOTH_HP, "the mirrored-side moth's hp as posed");

  const firing = await fireWeapon(h, "pyre", 1);
  await captureStill(h, "both");

  assertHit(firing.after, ahead, "the moth on the facing side");
  assertHit(firing.after, behind, "the moth on the mirrored side");
});
