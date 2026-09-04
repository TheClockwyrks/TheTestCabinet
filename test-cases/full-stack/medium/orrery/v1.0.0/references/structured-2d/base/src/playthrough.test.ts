// Orrery played through the engine, from the title to a solved challenge.
//
// `src/solutions.test.ts` proves every reference solution against the rules;
// this proves the same runs against the WHOLE BUILD — the engine's frame loop,
// the game mode's tick, the cue bus, the actor population, and the renderer —
// so a challenge that completes here completes for a player.
//
// The run is driven at the top speed `SPEEDS` offers, from frames of the
// harness's own clock, rather than by stepping cycles: what is checked is that
// the engine's own time carries the machine to a completed run.

import { describe, expect, it } from "vitest";

import { challengesOf } from "./challenges";
import { CAMPAIGN_REFERENCE_CYCLES, SPEEDS, TAGS } from "./constants";
import { createHarness, type Harness } from "./harness";
import type { Metrics, Mode } from "./types";

/**
 * The frame a long run is covered with: a whole second of simulated time
 * apiece, so `CAMPAIGN_REFERENCE_CYCLES` cycles at the top speed are twenty
 * frames rather than twelve hundred. A run advances by whole cycles however the
 * time was divided, so the outcome is the one a player reaches
 * (specs/instrumentation.md "A deterministic core").
 */
const LONG_FRAME_MS = 1000;

/** How many frames of `frameMs` it takes to cover `cycles` cycles at top speed. */
function framesFor(cycles: number, frameMs: number): number {
  const perFrame = (SPEEDS[SPEEDS.length - 1] * frameMs) / 1000;
  return Math.ceil(cycles / perFrame) + 4;
}

/**
 * Load a challenge's reference solution through the surface, run it off the
 * engine's own clock, and return the metrics the completed run recorded.
 */
async function playThrough(
  h: Harness,
  mode: Mode,
  index: number,
): Promise<Metrics> {
  h.debug.openChallenge(mode, index);
  h.debug.loadSolution(h.debug.referenceSolution(mode, index));
  h.debug.startRun();
  h.debug.setSpeed(SPEEDS.length - 1);
  await h.step(framesFor(CAMPAIGN_REFERENCE_CYCLES, LONG_FRAME_MS));
  const sim = h.state.sim;
  if (sim === null) throw new Error("the run ended");
  if (sim.status !== "complete" || sim.metrics === null) {
    throw new Error(
      `${mode} ${index + 1} is ${sim.status} at cycle ${sim.cycle}` +
        (sim.fault === null ? "" : `, fault ${sim.fault.kind}`),
    );
  }
  return sim.metrics;
}

for (const mode of ["campaign", "extras"] as const) {
  describe(`${mode} reference solutions complete on the engine`, () => {
    challengesOf(mode).forEach((challenge, index) => {
      it(`${index + 1}. ${challenge.name}`, async () => {
        const h = await createHarness({ frameMs: LONG_FRAME_MS });
        const metrics = await playThrough(h, mode, index);
        expect(metrics.cycles).toBeLessThanOrEqual(CAMPAIGN_REFERENCE_CYCLES);
        expect(metrics.cost).toBeGreaterThan(0);
        expect(metrics.area).toBeGreaterThan(0);
        // A completed run marks its challenge solved and records the metrics.
        const snapshot = h.debug.snapshot();
        const progress = snapshot[mode] as { solved: number[] };
        expect(progress.solved).toContain(index);
        h.dispose();
      });
    });
  });
}

describe("a session played from the title (specs/ui.md)", () => {
  it("reaches a solved challenge with the keyboard and the surface alone", async () => {
    const h = await createHarness();
    await h.step(1);

    // EXTRAS, from the title menu.
    h.tap("ArrowDown");
    await h.step(1);
    h.tap("Enter");
    await h.step(1);
    expect(h.debug.snapshot().screen).toBe("select");
    expect(h.debug.snapshot().mode).toBe("extras");

    // The first challenge, opened from its row.
    h.tap("Enter");
    await h.step(1);
    expect(h.debug.snapshot().screen).toBe("editor");

    // Its reference machine, and the run the space bar starts.
    h.debug.loadSolution(h.debug.referenceSolution("extras", 0));
    await h.step(1);
    h.tap("Space");
    await h.step(1);
    expect(h.state.sim?.status).toBe("running");
    expect(h.cues).toContain("start");
    // One actor per placed part, and the motes the settle raised.
    expect(h.engine.world.byTag(TAGS.part)).toHaveLength(
      h.state.editor.parts.length,
    );

    // At a player's own frame, and at a player's own speed step.
    h.debug.setSpeed(SPEEDS.length - 1);
    for (
      let round = 0;
      round < 20 && h.state.sim?.status === "running";
      round += 1
    ) {
      await h.step(30);
    }
    expect(h.state.sim?.status).toBe("complete");
    expect(h.cues).toContain("complete");

    // The solved panel's menu, taken back to the select screen.
    h.tap("ArrowUp");
    await h.step(1);
    h.tap("Enter");
    await h.step(1);
    expect(h.debug.snapshot().screen).toBe("select");
    const extras = h.debug.snapshot().extras as { solved: number[] };
    expect(extras.solved).toEqual([0]);
    h.dispose();
  });
});
