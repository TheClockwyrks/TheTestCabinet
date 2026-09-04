// Spectra — bursts/capped: live bursts are capped.
//
// `specs/assets.md`, the drone-burst's "How many" rule: "At most `MAX_BURSTS`
// (`24`) bursts play at once." It is the one rule of the effect that cannot be
// seen until more than `MAX_BURSTS` drones die inside one burst's play, which is
// exactly the case a full field taken by a discharge produces — and it is the
// rule that keeps a build's frame from collapsing there, since each live burst
// carries its own simulation of the seeded system's `235` particles.
//
// THE SCENARIO IS THE ONE THE RULE EXISTS FOR. `MAX_BURSTS + 6` drones, every
// one of them in phase `diving`, taken by a single discharge wave. Six over the
// cap rather than one, so a build that is off by one at the boundary is not what
// decides this and a build with no cap at all is unmistakable. Each drone holds
// its place — travel off — and fires nothing, so the wave is the only thing that
// happens and nothing on the field but the pops is under test.
//
// WHY THEY ALL POP INSIDE ONE BURST'S PLAY. `specs/resonance.md` gives the wave
// `DISCHARGE_TIME` (`0.5`) seconds to grow from `0` to `DISCHARGE_MAX_R`
// (`1500`), and the furthest of these drones is well under `900` units from the
// ship's lane, so every one of them is taken inside that half second — while a
// burst plays for `BURST_DURATION` (`0.7`) seconds, so the first pop is still
// playing when the last one starts. The roster is read at the end of the wave,
// where every burst the wave started would be live at once if nothing capped
// them.
//
// THE VERDICT IS THE CEILING, AND ONLY THE CEILING. Which bursts a build keeps
// when it is over the cap — the oldest displaced, or the newest refused — is the
// build's, and the specification fixes neither. What it fixes is that no more
// than `MAX_BURSTS` play at once, so that is what is asserted, over the
// precondition that this scenario really did destroy more drones than that in
// one wave and really did leave bursts playing.
//
// WHAT THIS DOES NOT DECIDE. That a discharge pops each drone it destroys is
// `bursts/discharge-pops`, and how long each one plays is
// `bursts/one-shot-ends`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertGreaterThan,
  assertLength,
  assertLessThanOrEqual,
} from "../assert";
import {
  BINDINGS,
  DISCHARGE_TIME,
  MAX_BURSTS,
  RESONANCE_MAX,
} from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";

/** The key `specs/controls.md` binds the discharge action to. */
const DISCHARGE_KEY = BINDINGS.discharge[0];

/** How many drones over the cap the wave takes. */
const OVER_CAP = 6;

/** How many divers are posed: six clear of the cap. */
const DIVER_COUNT = MAX_BURSTS + OVER_CAP;

/**
 * The block the divers are laid out on: ten across the width of the play field,
 * three rows down it, every place well inside `DISCHARGE_MAX_R` (`1500`) of the
 * ship's lane and clear of both HUD strips.
 */
const DIVER_COLUMNS = 10;
const DIVER_X0 = 100;
const DIVER_DX = 120;
const DIVER_Y0 = 150;
const DIVER_DY = 150;

/** Every place a diver is posed, filled row by row. */
const DIVERS_AT = Array.from({ length: DIVER_COUNT }, (_, index) => ({
  x: DIVER_X0 + DIVER_DX * (index % DIVER_COLUMNS),
  y: DIVER_Y0 + DIVER_DY * Math.floor(index / DIVER_COLUMNS),
}));

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("leaves at most the cap playing when a wave destroys more than it", async () => {
  await startPosed(h);
  for (const at of DIVERS_AT) {
    await poseDrone(h, "shard", at.x, at.y, { phase: "diving" });
  }

  const posed = await h.snapshot();
  assertLength(
    posed.drones,
    DIVERS_AT.length,
    "precondition: every diver is on the field",
  );
  assertGreaterThan(
    DIVERS_AT.length,
    MAX_BURSTS,
    `precondition: the wave is about to destroy more than MAX_BURSTS ` +
      `(${MAX_BURSTS}) drones`,
  );

  await h.debug.setResonance(RESONANCE_MAX);
  await h.tap(DISCHARGE_KEY);
  await h.advance(framesFor(DISCHARGE_TIME));

  // The bursts a mass kill left playing.
  await captureStill(h, "capped");

  const after = await h.snapshot();
  assertLength(
    after.drones,
    0,
    `precondition: the wave destroyed all ${DIVERS_AT.length} divers ` +
      `(specs/resonance.md)`,
  );
  assertGreaterThan(
    after.bursts.length,
    0,
    "precondition: the mass kill left bursts playing at all",
  );
  assertLessThanOrEqual(
    after.bursts.length,
    MAX_BURSTS,
    `the bursts playing at once after a single wave destroyed ` +
      `${DIVERS_AT.length} drones, ${OVER_CAP} more than the cap ` +
      `(specs/assets.md: at most MAX_BURSTS (${MAX_BURSTS}) bursts play at ` +
      `once)`,
  );
});
