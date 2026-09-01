// Wick — audio/hum-starts-on-acquire: the hum starts when Halo enters a
// weapon slot on `playing`.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md`, The loops: "`hum` is looping
// on every frame exactly when `screen` is `playing` and a held weapon is
// `halo` or `corona`. It starts on the frame that first makes both true,
// whether Halo was just acquired or play just resumed from an overlay or a
// pause". "Exactly when" makes the rule two-sided: with Halo not held the
// threshold is `false`, and from the frame it is held the threshold is
// `true`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding no weapon at all,
// where the hum is read as `false` first: what this point decides is that the
// hum STARTS on the acquisition, and a hum that was already running says
// nothing about the start. Then Halo alone is placed with `setWeapon`, which
// "Puts weapon `id`, a `WeaponId`, at `level` in `slot`", and the frames
// after it are read.
//
// `weaponFire` stays off, so Halo's pulses never run and nothing the aura
// does can raise a cue or end anything; the placement of the aura itself is
// not gated by a switch (`specs/instrumentation.md`, Placement), so the run
// is exactly the state the loop rule reads. The world holds no enemy,
// projectile, zone, gem, or pickup, so nothing else changes over the span,
// and `screen` stays `playing`, which is the rule's other conjunct.
//
// THE TOLERANCE. One frame for the reconciliation, which the specification
// itself grants — "Both loops are reconciled from the state on every frame"
// and, in `specs/instrumentation.md`, "by the next frame" — and no gap after
// it. The reading is a boolean.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CUES } from "../constants";
import {
  captureReplay,
  createHarness,
  holdWeapon,
  type Harness,
} from "../harness";
import { isolatedRun, loopTrace } from "./cues";

/** Frames read after the acquisition: the reconciling frame and half a second. */
const FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("has hum not looping without Halo and looping from the frame after it is held", async () => {
  const before = await isolatedRun(h);
  assertEqual(
    before.run.weapons.length,
    0,
    "the weapons held before Halo was acquired",
  );
  assertEqual(
    h.looping(CUES.hum),
    false,
    "whether the hum was already running with no Halo held (specs/ui.md, The loops)",
  );

  holdWeapon(h, "halo", 1);
  const trace = await captureReplay(h, "started", () =>
    loopTrace(h, CUES.hum, FRAMES),
  );

  assertEqual(
    h.snapshot().screen,
    "playing",
    "the screen the run held for the whole span",
  );
  assertEqual(
    trace.filter((looping) => !looping).length,
    0,
    `frames after Halo entered a slot on which hum was not looping, of ${FRAMES} (specs/ui.md, The loops)`,
  );
});
