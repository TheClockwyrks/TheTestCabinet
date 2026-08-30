/*
 * Coil validator: `movement.sub-tick-update-runs-no-tick`. PLACEHOLDER.
 *
 * An update shorter than a tick resolves none.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * An update covering less than TICK_SECONDS resolves no tick: ticks is
 * unchanged and the head has not moved, and the remainder carries so the tick
 * lands once the accumulated time reaches TICK_SECONDS.
 *
 * HOW:
 * advance a fraction of TICK_SECONDS, confirm nothing resolved, then advance
 * the remainder and confirm exactly one tick resolved.
 *
 * MEDIA IT MUST CAPTURE: carried (replay).
 *
 * It is a COMMON point, decided for every variant.
 *
 * The manifest declares this path, so the file must exist for the version to
 * resolve. It throws rather than passing, so a point whose suite has not been
 * written yet can never be mistaken for a point that passed. Replace the body:
 * pose the scenario through the debug surface alone, clearing everything the
 * claim is not about, run the real systems for a bounded span, assert the one
 * claim above through the shared assertion helpers, and capture the declared
 * media around the drive rather than around the arrangement.
 */
import { test } from "vitest";

test("movement.sub-tick-update-runs-no-tick", () => {
  throw new Error(
    "validator not implemented: movement/sub-tick-update-runs-no-tick.test.ts",
  );
});
