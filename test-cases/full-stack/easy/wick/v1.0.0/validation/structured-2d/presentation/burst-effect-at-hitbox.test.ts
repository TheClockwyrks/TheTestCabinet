// presentation/burst-effect-at-hitbox — Flare's burst sheet is painted over the
// burst's circle, for exactly as long as the zone is live.
//
// WHERE THE FIGURES COME FROM. `specs/assets.md`, "The weapon effects": the
// flare burst is "a sheet of `6`, played once" under
// `assets/sprites/effects/flare/0.png` to `5.png`, drawn over "the burst's
// circle, for `FLARE_FLASH` (`0.4`) seconds", and each effect is "scaled in
// code to the live shape ... so the effect's drawn extent is the hitbox's
// extent on every tick it is drawn". The same file adds the one thing that is
// special about this burst: "The burst is drawn at the full diameter of its
// circle, past the edges of the view where the circle reaches past them", and
// `specs/state.md` has "a burst's `radius`" be "its Flare `radius`", `640` on
// the level-1 row, so the drawn extent is `1280` and the sprite runs to both
// edges of the stage. WHICH frame of the sheet is up is the play-once item's
// question; this one asks only that SOME frame of Flare's own sheet is there.
//
// The bound is `EXTENT_TOL` (4 units) on the extent and `SPRITE_TOL` (2 units)
// on the centre, the rounding a build that lands its destination rectangle on
// whole device pixels picks up. A burst drawn at the produced canvas's fixed
// `128 x 128`, or shrunk to fit the stage, sits far outside.
//
// THE WORLD, AND WHY. An isolated world holding Flare alone at level 1, with no
// enemy at all: `specs/weapons.md` says "Flare fires whether or not any enemy
// exists, and amount is ignored", so the empty field is the cleanest firing and
// nothing else can be drawn over the stage. `armWeapon` puts the slot's timer
// at `0`, which `specs/instrumentation.md` makes the next tick its firing tick.
// The burst's `ttl` is `FLARE_FLASH` (24 ticks) against Flare's level-1
// cooldown of `60` seconds, so no second burst fires inside the trace.

import { afterEach, beforeEach, it } from "vitest";
import { assertNull } from "../assert";
import {
  armWeapon,
  captureReplay,
  createHarness,
  holdWeapon,
  isolate,
  zonesOfKind,
  type Harness,
  type WickSnapshot,
} from "../harness";
import {
  assertDrawnOverShape,
  circleShape,
  traceEffect,
  type Shape,
} from "./effects";
import { effectFiles } from "./sprites";

/** The one live burst, as its circle. */
function burst(snapshot: WickSnapshot): Shape | null {
  const [zone] = zonesOfKind(snapshot, "burst");
  return zone === undefined ? null : circleShape(zone);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws a flare sheet frame over the burst's circle for its flash", async () => {
  isolate(h);
  const slot = holdWeapon(h, "flare", 1);
  assertNull(burst(h.snapshot()), "a burst before the weapon has fired");
  armWeapon(h, slot);

  const trace = await captureReplay(h, "effect", () =>
    traceEffect(h, burst, { maxTicks: 60 }),
  );

  assertDrawnOverShape(h, trace, effectFiles("flare"), "Flare burst");
});
