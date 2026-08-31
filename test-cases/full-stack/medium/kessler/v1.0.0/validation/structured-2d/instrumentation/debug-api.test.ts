// instrumentation/debug-api — the debug and automation surface is present,
// whole, and live.
//
// specs/instrumentation.md: "the game instance's `initialize` returns the
// finished surface. The engine holds it and returns it from `engine.debug`,
// and it is reached that way alone ... Every scenario driven from code reaches
// the game through it, so it is present and exactly as specified here." The
// operations it must carry are the ones the same file enumerates under "The
// operations".
//
// TWO HALVES. The first is presence: every operation the mode names, read off
// the raw surface as a function. The second is that the surface is LIVE rather
// than hollow: "a pose changes the running game and snapshot reads the change
// back", and the game's own tick runs on from the posed state. Whether each
// individual operation does exactly what its section states is the business of
// the per-operation points that follow — a surface that is missing or inert
// fails HERE, by name, rather than only as every other suite failing to run.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, openHarness, type Harness } from "../harness";
import { rawSurface, REQUIRED_OPS } from "./helpers";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("carries every operation its mode names, as functions", () => {
  const raw = rawSurface(h);
  for (const op of REQUIRED_OPS) {
    assertEqual(typeof raw[op], "function", `the surface's ${op}`);
  }
});

it("is live: a pose changes the running game and snapshot reads it back", async () => {
  h.reset();
  h.debug.setScreen("playing");
  h.debug.setScore(500);
  const posed = h.snapshot();

  // And the game RUNS from there: a driven tick advances the game's own clock
  // over the posed session rather than over a copy the surface answered from.
  const after = await h.tick(1);
  captureStill(h, "surface");

  assertEqual(posed.screen, "playing", "the posed screen, read back");
  assertEqual(posed.score, 500, "the posed score, read back");
  assertEqual(after.ticks, posed.ticks + 1, "ticks across one driven tick");
  assertEqual(after.score, 500, "the posed score, held by the running game");
});
