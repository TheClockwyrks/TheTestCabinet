// The fifteen cues: one per event, at most once on the tick that raised it, and
// exactly one bed looping under the hall while it is in play.
//
// What a check reads is the engine's own `cue:played`, `cue:looped` and
// `cue:stopped` events, which are emitted whether or not the host can actually
// sound anything — so a headless process reports the same cues a browser sounds.

import { describe, expect, it } from "vitest";
import { BINDINGS, CUES, LOOPING_CUES, SPACING } from "./constants";
import { CUE_FALLBACKS, cuePath } from "./audio";
import { bare, harness, seatShot, topLegS } from "./harness.test";

describe("the cue table", () => {
  it("names fifteen cues, each with a produced file and a declared shape", () => {
    const names = Object.values(CUES);
    expect(new Set(names).size).toBe(15);
    for (const cue of names) {
      expect(cuePath(cue)).toBe(`audio/${cue}.wav`);
      expect(CUE_FALLBACKS[cue].durationMs).toBeGreaterThan(0);
    }
    // The two beds are the ones that loop.
    expect([...LOOPING_CUES]).toEqual([CUES.hallLoop, CUES.dangerLoop]);
  });

  it("rises in pitch across the five extraction steps", () => {
    const steps = [
      CUES.extract1,
      CUES.extract2,
      CUES.extract3,
      CUES.extract4,
      CUES.extract5,
    ];
    for (let i = 1; i < steps.length; i += 1) {
      expect(CUE_FALLBACKS[steps[i]].freq).toBeGreaterThan(
        CUE_FALLBACKS[steps[i - 1]].freq,
      );
    }
  });
});

describe("one cue per event", () => {
  it("sounds the shot, the refusal, the swap and the seat", async () => {
    const h = await bare();
    h.tap(BINDINGS.a[0]);
    await h.step();
    expect(h.since(0)).toContain("fire");

    let marker = h.cues.length;
    h.tap(BINDINGS.a[0]);
    await h.step();
    expect(h.since(marker)).toEqual(["denied"]);

    marker = h.cues.length;
    h.tap(BINDINGS.b[0]);
    await h.step();
    expect(h.since(marker)).toEqual(["swap"]);

    marker = h.cues.length;
    await seatShot(h, [[topLegS(440), "halide", null]]);
    expect(h.since(marker)).toContain("seat");
    h.dispose();
  });

  it("sounds the extraction step the chain resolved at", async () => {
    const h = await bare();
    const head = topLegS(430);
    const marker = h.cues.length;
    await seatShot(
      h,
      [
        [head, "halide", null],
        [head - SPACING, "halide", null],
        [head - 2 * SPACING, "cobalt", null],
      ],
      "halide",
    );
    const raised = h.since(marker);
    expect(raised).toContain("extract-1");
    expect(raised).not.toContain("extract-2");
    h.dispose();
  });

  it("sounds a granted machinery", async () => {
    const h = await bare();
    const head = topLegS(430);
    const marker = h.cues.length;
    await seatShot(
      h,
      [
        [head, "halide", null],
        [head - SPACING, "halide", "choke"],
        [head - 2 * SPACING, "cobalt", null],
      ],
      "halide",
    );
    expect(h.since(marker)).toContain("machinery");
    h.dispose();
  });

  it("sounds the intake and the lost cell together, each once", async () => {
    const h = await bare();
    h.api.poseTrain([
      [5000, "halide", null],
      [4972, "halide", null],
    ]);
    const marker = h.cues.length;
    await h.step();
    const raised = h.since(marker);
    expect(raised.filter((cue) => cue === "intake")).toHaveLength(1);
    expect(raised.filter((cue) => cue === "cell-lost")).toHaveLength(1);
    h.dispose();
  });

  it("sounds the clear once when a level is cleared", async () => {
    const h = await bare();
    const head = topLegS(430);
    const marker = h.cues.length;
    await seatShot(
      h,
      [
        [head, "halide", null],
        [head - SPACING, "halide", null],
      ],
      "halide",
      // Spent on the strike tick alone, so the level clears on the extraction.
      () => {
        h.api.setQuotaRemaining(0);
      },
    );
    expect(h.since(marker).filter((cue) => cue === "level-clear")).toHaveLength(
      1,
    );
    h.dispose();
  });

  it("sounds a cue at most once on the tick that raised it", async () => {
    const h = await bare();
    // Two runs of three, each drawn out by the same merge tick, both at step 1's
    // cue: the tick sounds that step once.
    const head = topLegS(430);
    const marker = h.cues.length;
    await seatShot(
      h,
      [
        [head, "halide", null],
        [head - SPACING, "halide", null],
        [head - 2 * SPACING, "halide", null],
        [head - 3 * SPACING, "halide", null],
        [head - 4 * SPACING, "cobalt", null],
      ],
      "halide",
    );
    expect(h.since(marker).filter((cue) => cue === "extract-1")).toHaveLength(
      1,
    );
    h.dispose();
  });
});

describe("the music beds", () => {
  it("loops nothing on the title", async () => {
    const h = await harness();
    await h.step(5);
    expect(h.looped).toEqual([]);
    h.dispose();
  });

  it("loops the hall bed under a run, and stops it when play ends", async () => {
    const h = await harness();
    h.api.start();
    await h.step();
    expect(h.looped).toEqual([CUES.hallLoop]);
    expect(h.engine.state.screen).toBe("playing");

    h.api.pause();
    await h.step();
    expect(h.stopped).toEqual([CUES.hallLoop]);
    h.dispose();
  });

  it("swaps to the danger bed on the tick the head crosses the threshold", async () => {
    const h = await bare();
    h.api.poseTrain([[3990, "halide", null]]);
    await h.step();
    expect(h.looped).toEqual([CUES.hallLoop]);

    h.api.poseTrain([[4100, "halide", null]]);
    await h.step();
    expect(h.looped).toEqual([CUES.hallLoop, CUES.dangerLoop]);
    expect(h.stopped).toEqual([CUES.hallLoop]);
    // Never both at once.
    expect(h.engine.state.screen).toBe("playing");
    h.dispose();
  });

  it("returns to the hall bed when the danger passes", async () => {
    const h = await bare();
    h.api.poseTrain([[4100, "halide", null]]);
    await h.step();
    h.api.poseTrain([[1000, "halide", null]]);
    await h.step();
    expect(h.looped).toEqual([CUES.dangerLoop, CUES.hallLoop]);
    h.dispose();
  });
});

describe("mute", () => {
  it("is the engine's bit, toggled by the game and reported in the state", async () => {
    const h = await harness();
    h.api.start();
    await h.step();
    expect(h.api.snapshot().muted).toBe(false);

    h.tap(BINDINGS.mute[0]);
    await h.step();
    expect(h.api.snapshot().muted).toBe(true);
    // The bed goes on looping, silently.
    expect(h.stopped).toEqual([]);

    // A muted cue is still announced, at no gain.
    const marker = h.cues.length;
    h.tap(BINDINGS.a[0]);
    await h.step();
    const fired = h.cues.slice(marker).find((play) => play.cue === "fire");
    expect(fired).toBeDefined();
    expect(fired?.gain).toBe(0);
    h.dispose();
  });
});
