// The property specs/instrumentation.md rests the whole surface on: an
// interval of game time reaches the same state however it was divided into
// frames. "`advance(1, 1)` and `advance(1, 60)` cover the same cycles and
// reach the same outcome, to the precision the deterministic core fixes."
//
// The interesting case is a span that lands EXACTLY on a cycle boundary. In
// exact arithmetic one second at `SPEEDS[1]` (3 cycles per second) is three
// whole cycles; in binary floating point a sum of sixty terms of `3 * (1/60)`
// falls a few ulps short of `3`, so a clock that tested the boundary with a
// bare `<` would run two cycles at the fine division and three at the coarse
// one. `CYCLE_EPSILON` in `src/sim.ts` is what closes that gap, and these
// tests are what would catch its removal.

import { describe, expect, it } from "vitest";

import { SPEEDS } from "./constants";
import { createDebugApi } from "./debug";
import { Bench } from "./harness";
import { challengesOf } from "./challenges";
import type { Mode } from "./types";
import { advanceFrame } from "./flow";

/**
 * Open a challenge with its reference solution running, advance `seconds` of
 * game time in `frames` equal frames, and return the run as plain data.
 */
function runFor(
  mode: Mode,
  index: number,
  seconds: number,
  frames: number,
): Record<string, unknown> {
  const game = new Bench();
  const api = createDebugApi(() => game);
  api.openChallenge(mode, index);
  api.loadSolution(api.referenceSolution(mode, index));
  api.startRun();
  const dt = seconds / frames;
  for (let frame = 0; frame < frames; frame += 1) advanceFrame(game, dt);
  return JSON.parse(JSON.stringify(api.snapshot().sim)) as Record<
    string,
    unknown
  >;
}

/**
 * Everything about a run that is a discrete fact rather than a position along
 * the current cycle: the cycle count, the status, the outcome, and where every
 * mote, filament, pose, and grip stands.
 *
 * These must agree BIT FOR BIT across frame divisions. `fraction`, and the
 * drawn `x`/`y` derived from it, are the one exception: within a cycle the
 * fraction is the plain running sum of `SPEEDS[speed] * dt` the specification
 * fixes, and a sum of many terms is not bit-identical to a sum of one. That
 * residue is checked separately, to a tolerance, below.
 */
function discrete(sim: Record<string, unknown>): unknown {
  const motes = sim.motes as { x: number; y: number }[];
  return {
    ...sim,
    fraction: undefined,
    motes: motes.map((mote) => ({ ...mote, x: undefined, y: undefined })),
  };
}

describe("the run is a function of elapsed game time, not of frame rate", () => {
  // Spans that land exactly on a cycle boundary at the default speed, and one
  // that lands mid-cycle, so both the boundary case and the ordinary one run.
  const SPANS = [1, 7, 23.5, 60];
  const DIVISIONS = [1, 3, 60, 600];

  for (const mode of ["campaign", "extras"] as const) {
    challengesOf(mode).forEach((challenge, index) => {
      it(`${mode} ${index + 1}. ${challenge.name}`, () => {
        for (const seconds of SPANS) {
          const reference = runFor(mode, index, seconds, DIVISIONS[0]);
          for (const frames of DIVISIONS.slice(1)) {
            const at = `${seconds}s in ${frames} frames`;
            const other = runFor(mode, index, seconds, frames);
            expect(discrete(other), at).toEqual(discrete(reference));
            expect(other.fraction as number, at).toBeCloseTo(
              reference.fraction as number,
              9,
            );
          }
        }
      });
    });
  }

  it("runs the whole cycle count a span covers, at every division", () => {
    // Three seconds at SPEEDS[1] is nine whole cycles, boundary-exact.
    const cycles = SPEEDS[1] * 3;
    for (const frames of [1, 2, 9, 100, 1000]) {
      const game = new Bench();
      const api = createDebugApi(() => game);
      api.openChallenge("extras", 0);
      api.startRun();
      for (let frame = 0; frame < frames; frame += 1)
        advanceFrame(game, 3 / frames);
      expect(game.state.sim?.cycle, `${frames} frames`).toBe(cycles);
      expect(game.state.sim?.fraction, `${frames} frames`).toBe(0);
      expect(game.state.sim?.status, `${frames} frames`).toBe("running");
    }
  });

  it("carries a mid-cycle span to the same fraction at every division", () => {
    for (const frames of [1, 5, 50, 500]) {
      const game = new Bench();
      const api = createDebugApi(() => game);
      api.openChallenge("extras", 0);
      api.startRun();
      // 1.5 cycles: half a cycle past the first boundary.
      for (let frame = 0; frame < frames; frame += 1)
        advanceFrame(game, 0.5 / SPEEDS[1] / frames);
      expect(game.state.sim?.cycle, `${frames} frames`).toBe(0);
      expect(game.state.sim?.fraction ?? 0, `${frames} frames`).toBeCloseTo(
        0.5,
        9,
      );
    }
  });
});
