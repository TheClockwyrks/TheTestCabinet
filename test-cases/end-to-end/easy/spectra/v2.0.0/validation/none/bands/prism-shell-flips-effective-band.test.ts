// bands/prism-shell-flips-effective-band — a broken shell exposes the other band.
//
// specs/bands.md lists the first of the three swaps as "The entity is a Prism
// whose shell has been broken, so the layer now exposed is its core", and
// specs/drones.md says what that layer is: "A Prism wears an outer shell of one
// band around an inner core of the other. The shell's band is the Prism's stored
// band, and the core's is always the opposite." So a stored-cyan Prism with its
// shell gone reads magenta, and a magenta shot is what takes its core.
//
// The v2.0.0 surface reports no `coreBand`: the core's band is derivable, and
// this item is the reading that says a build derived it. A build that kept the
// two bands as separate stored fields and forgot to swap the reported one passes
// nothing here.
//
// The shell is posed broken with `setDroneShell(id, false)` rather than shot off,
// so the reading is about the exposed layer alone: which shot BREAKS a shell is
// the `drones` category's. No inversion is running, so the shell is the only swap
// in play and the reading is unambiguous — the composition of the two swaps is
// the sibling `bands/inversion-cancels-two-swaps`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { FORM_CENTER_X } from "../constants";
import {
  captureStill,
  createHarness,
  poseDrone,
  requireDrone,
  startPosed,
  type Harness,
} from "../harness";

/** Where the Prism stands: mid-field, clear of both HUD strips and of the ship. */
const AT = { x: FORM_CENTER_X, y: 300 } as const;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("reads a stored-cyan Prism whose shell is broken as magenta", async () => {
  await startPosed(harness);
  const id = await poseDrone(harness, "prism", AT.x, AT.y, {
    band: "cyan",
    shell: false,
  });
  // One frame, so the picture kept below is the posed field rather than the one
  // before it.
  await harness.advance(1);

  const posed = await harness.snapshot();
  await captureStill(harness, "exposed");

  assertEqual(
    posed.inversionActive,
    false,
    "no inversion running, so the broken shell is the only swap in play",
  );
  const prism = requireDrone(
    posed,
    id,
    "the Prism whose shell was posed broken",
  );
  assertEqual(
    prism.shellAlive,
    false,
    "the broken shell the scenario posed (specs/instrumentation.md)",
  );
  assertEqual(
    prism.band,
    "cyan",
    "the Prism's stored band, which is its shell's and does not change when the shell falls (specs/drones.md)",
  );
  assertEqual(
    prism.effectiveBand,
    "magenta",
    "the band a stored-cyan Prism with its shell broken reads as: its core's (specs/bands.md)",
  );
});
