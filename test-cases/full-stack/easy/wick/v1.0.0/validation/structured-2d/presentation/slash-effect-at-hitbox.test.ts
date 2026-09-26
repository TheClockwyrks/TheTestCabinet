// presentation/slash-effect-at-hitbox — Taper's slash sprite is painted over
// the rectangle the slash hits in, for exactly as long as that rectangle is
// live.
//
// WHERE THE FIGURES COME FROM. `specs/assets.md`, "The weapon effects": the
// slash is one produced sprite at `assets/sprites/effects/taper.png`, drawn
// over "the `width x height` rectangle, for `SLASH_FLASH` (`0.1`) seconds",
// and each effect "is produced on the canvas its row states and scaled in code
// to the live shape ... so the effect's drawn extent is the hitbox's extent on
// every tick it is drawn". `specs/state.md` reports that rectangle:
// "`width`, `height`: the full extent of a slash's rectangle, after the area
// multiplier. They are present on a slash and absent on every other kind", and
// its `x`, `y` are "the center of the rectangle".
//
// So nothing here hard-codes the rectangle: the trace reads the slash's own
// centre and extent off the snapshot on every tick, and the frame that tick
// drew must carry `taper.png` there. The bound is `EXTENT_TOL` (4 units) on
// each extent and `SPRITE_TOL` (2 units) on the centre, which is the rounding
// a build that lands its destination rectangle on whole device pixels picks
// up; a slash drawn at a fixed canvas size, or centred on the lamplighter
// instead of on its rectangle, sits far outside both.
//
// THE WORLD, AND WHY. An isolated world holding Taper alone: no enemy, no
// other weapon, no passive, and every driver switch off but `weaponFire`, so
// the only shape that can appear is the slash and no `areaMul` moves its
// extent off the level-1 row. `armWeapon` puts the slot's timer at `0`, which
// `specs/instrumentation.md` makes the next tick its firing tick. Taper's
// level-1 cooldown is `1.35` seconds (81 ticks) against a slash's 6, so the
// trace ends long before a second slash could fire.

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
import { assertDrawnOverShape, traceEffect, type Shape } from "./effects";
import { effectFiles } from "./sprites";

/** The one live slash, as its rectangle: its centre, its width, and its height. */
function slash(snapshot: WickSnapshot): Shape | null {
  const [zone] = zonesOfKind(snapshot, "slash");
  if (zone === undefined) return null;
  return { x: zone.x, y: zone.y, w: zone.width ?? 0, h: zone.height ?? 0 };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws taper.png over the slash rectangle for the whole of its flash", async () => {
  isolate(h);
  const slot = holdWeapon(h, "taper", 1);
  assertNull(slash(h.snapshot()), "a slash before the weapon has fired");
  armWeapon(h, slot);

  const trace = await captureReplay(h, "effect", () =>
    traceEffect(h, slash, { maxTicks: 40 }),
  );

  assertDrawnOverShape(h, trace, effectFiles("taper"), "Taper slash");
});
