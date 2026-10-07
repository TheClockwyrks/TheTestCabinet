// injector/swap — the swap control exchanges the loaded charge with the queued
// charge.
//
// WHERE THE THRESHOLD COMES FROM. specs/injector.md ("The loaded and queued
// cores"): "The injector holds a **loaded** core and a **queued** core, each
// carrying one charge ... Firing moves the queued charge into the loaded slot and
// draws a new queued charge; a swap exchanges the two charges, draws nothing, and
// is available whether or not the fire cooldown has expired."
// specs/controls.md ("Actions") gives `b` the exchange, read as a press
// edge and live on `playing` alone, and `src/constants.ts` binds it to `KeyX`. specs/instrumentation.md's `setLoaded` / `setQueued` "sets the
// core the injector holds loaded, and the one it holds queued, to `charge`", and
// changes nothing else — so the two charges the check poses are the two it reads
// back, and no draw can substitute for the exchange.
//
// THE TWO CHARGES. `halide` and `cobalt`, the pair the review item names. They
// are distinct, which is the whole of what the reading needs: after the press the
// loaded slot must hold what the queued slot held and the queued slot what the
// loaded slot held, so a build that draws a fresh pair, that copies one slot into
// the other, or that does nothing at all misses. Both are in level 1's charge set
// (specs/progression.md), so nothing about the pose is out of the ordinary for the
// level it is posed on.
//
// THE HALL. `poseHall` holds the inlet with `setEmission(false)` and leaves the
// level's quota where it stands, so no core arrives and the "quota exhausted and
// channel empty" clear of specs/progression.md never fires — which is what keeps
// the screen on `playing`, where this control is live (specs/controls.md). The
// channel is EMPTY: nothing stands in the hall but the injector.
//
// TOLERANCE. None. A charge id is one of five names and the case grades it
// exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseHall,
  pressSwap,
  type Harness,
} from "../harness";

/** The charge the injector is posed holding loaded. */
const LOADED = "halide";

/** The charge it is posed holding queued, distinct from the loaded one. */
const QUEUED = "cobalt";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("exchanges the loaded and queued charges when the swap control is raised", async () => {
  await poseHall(h, { loaded: LOADED, queued: QUEUED });

  const posed = await h.snapshot();
  assertEqual(posed.injector.loaded, LOADED, "the charge posed as loaded");
  assertEqual(posed.injector.queued, QUEUED, "the charge posed as queued");

  const swapped = await pressSwap(h);
  await captureStill(h, "swapped");

  assertEqual(
    swapped.injector.loaded,
    QUEUED,
    "the loaded charge after a swap",
  );
  assertEqual(
    swapped.injector.queued,
    LOADED,
    "the queued charge after a swap",
  );
});
