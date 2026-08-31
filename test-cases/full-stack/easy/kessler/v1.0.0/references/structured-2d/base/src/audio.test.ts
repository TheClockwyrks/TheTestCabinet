// The per-screen bed rule and the cue declarations (specs/assets.md "The
// sound"). Every cue name and both beds carry a synthesized fallback, so a
// host that cannot load a produced file still declares every name the ticks
// play.

import { describe, expect, it } from "vitest";
import { BED_CUES, CUE_FALLBACKS, bedForScreen } from "./audio";
import { CUES } from "./constants";

describe("bedForScreen", () => {
  it("loops the title bed on title and howto", () => {
    expect(bedForScreen("title")).toBe(BED_CUES.title);
    expect(bedForScreen("howto")).toBe(BED_CUES.title);
  });

  it("loops the play bed on playing, waveclear, and paused", () => {
    expect(bedForScreen("playing")).toBe(BED_CUES.play);
    expect(bedForScreen("waveclear")).toBe(BED_CUES.play);
    expect(bedForScreen("paused")).toBe(BED_CUES.play);
  });

  it("plays no bed on gameover, so the cue rings out over silence", () => {
    expect(bedForScreen("gameover")).toBe(null);
  });
});

describe("the cue declarations", () => {
  it("carries a fallback shape for every one of the thirteen cues", () => {
    for (const cue of Object.values(CUES)) {
      expect(CUE_FALLBACKS[cue], cue).toBeDefined();
      expect(CUE_FALLBACKS[cue].durationMs).toBeGreaterThan(0);
    }
  });

  it("keeps the game-over fallback the longest and lowest of the set", () => {
    const gameOver = CUE_FALLBACKS[CUES.gameOver];
    for (const cue of Object.values(CUES)) {
      if (cue === CUES.gameOver) continue;
      expect(CUE_FALLBACKS[cue].durationMs).toBeLessThan(gameOver.durationMs);
    }
  });
});
