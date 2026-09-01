// halo/aura-centered-on-player — the aura is centered on the lamplighter on
// every tick.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Halo"): the aura is
// "a circle of `radius` centered on the player's center every tick".
// `specs/world.md` ("One tick") orders the phases: the lamplighter moves in
// phase 2 and "the aura's center ... [is] placed about the lamplighter's
// position of this tick" in phase 5, so the aura's `x`, `y` read the
// lamplighter's `x`, `y` after the move of the same tick, on every tick, and
// "Every zone's position is the center of its shape" (`specs/weapons.md`,
// Shapes and overlap). `specs/instrumentation.md` (Snapshot shape): "Every
// zone's `x`, `y` is its center".
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with Halo held at level 1
// and every driver switch off, so the aura is placed (placement is gated by
// no switch) and nothing else moves or fires. The lamplighter is moved by a
// held `ArrowRight` for `LEG` ticks and then a held `ArrowDown` for `LEG`
// ticks, 3 units a tick with no Bellows held (`specs/world.md`, Movement),
// so both axes change and each tick's reading compares the aura against a
// lamplighter that moved on that tick. The two legs are sampled a tick at a
// time, so the reading is per tick rather than at the end of a span.
//
// THE TOLERANCE. `REAL_EPS` on each axis: the aura's center is a copy of the
// lamplighter's position, not an integration of its own.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { REAL_EPS } from "../constants";
import {
  captureReplay,
  createHarness,
  holdSampling,
  holdWeapon,
  isolate,
  type Harness,
  type WickSnapshot,
} from "../harness";
import { theAura } from "./aura";

/** Ticks of each held leg. */
const LEG = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** The aura's center reads the lamplighter's on this tick. */
function assertCentered(s: WickSnapshot, label: string): void {
  const aura = theAura(s);
  const { player } = s.run;
  assertNear(
    aura.x,
    player.x,
    REAL_EPS,
    `the aura's x against the lamplighter's on ${label} (specs/weapons.md, Halo)`,
  );
  assertNear(
    aura.y,
    player.y,
    REAL_EPS,
    `the aura's y against the lamplighter's on ${label} (specs/weapons.md, Halo)`,
  );
}

it("reads the aura's x and y as the lamplighter's on every tick of a walk right and then down", async () => {
  isolate(h);
  holdWeapon(h, "halo", 1);

  const [right, down] = await captureReplay(h, "centered", async () => [
    await holdSampling(h, ["ArrowRight"], LEG),
    await holdSampling(h, ["ArrowDown"], LEG),
  ]);

  right.forEach((s, i) => assertCentered(s, `tick ${i + 1} of the walk right`));
  down.forEach((s, i) => assertCentered(s, `tick ${i + 1} of the walk down`));
});
