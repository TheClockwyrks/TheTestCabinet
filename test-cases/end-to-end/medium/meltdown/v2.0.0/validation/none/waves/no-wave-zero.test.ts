// waves/no-wave-zero — a run opens on Wave 1.
//
// `specs/waves.md`, Wave numbering: "A run opens on Wave 1; there is no Wave 0."
//
// THE RUN IS STARTED THROUGH THE MENUS, because the claim is about what STARTING
// a run leaves behind and `specs/instrumentation.md` gives `setWave` no entry
// effect at all — it "rebuilds nothing, releases nothing, and clears nothing". A
// posed number would be this check reading its own write. `startThroughMenus`
// takes PLAY, CONTAINMENT and MEDIUM in turn, so the number read is the one the
// run's own transition wrote.
//
// THE READING IS TAKEN AT ONCE, before anything is sent and before any wave is
// released, which is the "from the moment a run starts" the item names. What the
// number does afterwards belongs to `waves/clearing-advances-the-wave` and
// `waves/wave-number-holds-through-the-build-phase`; what it does at the end of a
// run belongs to `waves/wave-never-exceeds-n`.
//
// WHAT THIS POINT DOES NOT ASSERT. Not the money, not the lives, not the mode's
// derived figures: what a started run opens HOLDING is
// `modes.run-opens-with-its-figures`'s requirement. The one reading is the wave
// number.
//
// WHAT EVERY WRONG MODEL READS. A build that counts waves already fought opens on
// `0`; one that pre-increments on the release opens on `0` too and is told apart
// by `clearing-advances-the-wave`; one that carries the number over from a
// previous run opens on whatever that run reached.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { startThroughMenus } from "./run";

/** The wave number a run opens on (`specs/waves.md`). */
const FIRST_WAVE = 1;

/** The difficulty the run is started on: Containment's middle row. */
const DIFFICULTY = "medium";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("opens a fresh run on Wave 1", async () => {
  await startThroughMenus(h, DIFFICULTY);

  await captureStill(h, "first");

  const opened = await h.snapshot();
  assertEqual(
    opened.phase,
    "opening",
    "precondition: the menus reached the opening phase of a run",
  );
  assertEqual(
    opened.wave,
    FIRST_WAVE,
    "the wave number a run opens on, before anything has been sent",
  );
});
