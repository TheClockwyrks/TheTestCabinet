// bands/prism-shell-flips-effective-band — a broken shell exposes the other band.
//
// specs/bands.md lists the first of the three swaps as "The entity is a Prism whose
// shell has been broken, so the layer now exposed is its core", and specs/drones.md
// says what that layer is: "A Prism wears an outer shell of one band around an
// inner core of the other. The shell's band is the Prism's stored band, and the
// core's is always the opposite." So a stored-cyan Prism with its shell gone reads
// magenta, and a magenta shot is what would take its core.
//
// THE SURFACE REPORTS NO `coreBand`: the core's band is derivable, and this point
// is the reading that says a build derived it. A build that kept the two bands as
// separate stored fields and forgot to swap the reported one passes nothing here.
//
// THE SHELL IS POSED BROKEN with `setDroneShell(id, false)` rather than shot off,
// so the reading is about the exposed layer alone: WHICH shot breaks a shell is the
// `drones` category's. No inversion is running — `startPosed` leaves `inversion` at
// `0`, and the check reads that — so the shell is the only swap in play and the
// reading is unambiguous. The COMPOSITION of the two swaps is the sibling
// `bands.inversion-cancels-two-swaps`.
//
// THE READING IS A TRIPLE: the shell is down, the stored band is untouched, and the
// effective band is the opposite. The middle one matters because specs/drones.md
// makes the stored band the SHELL's and keeps it there when the shell falls: a
// build that rewrote `band` on the break would read the right effective band for
// the wrong reason, and fails here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import {
  LANE_CENTER,
  captureStill,
  createHarness,
  droneById,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";

/** Where the Prism stands: mid-field, clear of both HUD strips and of the ship. */
const AT_X = LANE_CENTER;
const AT_Y = 320;

/** The Prism's stored band — its shell's — and the band its core reads as. */
const SHELL = "cyan" as const;
const CORE = "magenta" as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads a stored-cyan Prism whose shell is broken as magenta", async () => {
  startPosed(h);
  const id = poseDrone(h, "prism", AT_X, AT_Y, { band: SHELL, shell: false });
  // One frame, so the picture kept below is the posed field rather than the one
  // before it.
  await h.advance(1);

  const posed = h.snapshot();
  captureStill(h, "exposed");

  assertEqual(
    posed.inversionActive,
    false,
    "no inversion running, so the broken shell is the only swap in play",
  );
  const prism = droneById(posed, id);
  if (prism === undefined) {
    fail(
      "the posed Prism still on the drone roster (specs/instrumentation.md)",
      "no drone carries the id addDrone appended",
    );
  }
  assertEqual(
    prism.shellAlive,
    false,
    "the broken shell the scenario posed (specs/instrumentation.md)",
  );
  assertEqual(
    prism.band,
    SHELL,
    `the Prism's stored band, which is its shell's and does not change when the ` +
      `shell falls (specs/drones.md)`,
  );
  assertEqual(
    prism.effectiveBand,
    CORE,
    `the band a stored-${SHELL} Prism with its shell broken reads as: its ` +
      `core's, the opposite of the shell's (specs/bands.md, specs/drones.md)`,
  );
});
