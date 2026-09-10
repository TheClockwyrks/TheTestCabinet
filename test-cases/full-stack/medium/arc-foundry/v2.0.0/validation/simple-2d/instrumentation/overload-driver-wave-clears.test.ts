// instrumentation/overload-driver-wave-clears — the driver's Dynamo leaves the
// phase where it found it.
//
// `specs/instrumentation.md` gives `spawnUnit` one hold and one release: the run
// enters "a live wave whose spawn schedule is empty. That wave clears the ordinary
// way, when every one of those units has died or leaked, and clearing it pays the
// ordinary wave-clear bonus and opens the next build phase." It then says so of
// this unit by name: "This holds whatever was released, the Overload Dynamo
// included: what a driver-released Dynamo changes is what `phase` READS while it is
// on the yard, and the wave underneath it is the ordinary one, so once it has gone
// the wave clears into the next build phase on the run's own wave number and the
// screen stays `playing`."
//
// WHY THIS IS ITS OWN POINT. `spawner-hold` releases an ordinary unit and reads
// the hold and the clear. This releases the one type that changes what `phase`
// reports, and reads the phase AFTER it has gone. A build that latches the finale
// when the Dynamo is released and clears it only where a real finale ends leaves
// stale derived state on the surface every other check poses through: the phase
// reads `finale` for the rest of the harness's life, on a yard with nothing on it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureReplay,
  createHarness,
  openYard,
  releaseUnit,
  type Harness,
} from "../harness";

/** A wave in the middle of a run, so the clear opens a build phase rather than a finale. */
const WAVE = 3;

/** Frames advanced after the yard empties, for the wave to clear. */
const SETTLE = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads finale while the Dynamo is out and build once it has gone", async () => {
  openYard(h, { wave: WAVE });
  releaseUnit(h, "overload", { frozen: true });

  const out = h.snapshot();
  assertEqual(
    out.phase,
    "finale",
    "the phase while a driver-released Overload Dynamo is on the yard " +
      "(specs/instrumentation.md)",
  );

  const cleared = await captureReplay(h, "cleared", async () => {
    h.debug.clearUnits();
    await h.advance(SETTLE);
    return h.snapshot();
  });

  assertLength(
    cleared.units,
    0,
    "the yard's live units once the Dynamo is gone",
  );
  assertEqual(
    cleared.phase,
    "build",
    "the phase the driver's wave clears into: the wave clears the ordinary way " +
      "and opens the next build phase (specs/instrumentation.md)",
  );
  assertEqual(
    cleared.wave,
    WAVE,
    "the wave number, which a clear leaves where the run stood",
  );
  assertEqual(
    cleared.screen,
    "playing",
    "the screen, because a driver's Dynamo grounding out is not a victory",
  );
});
