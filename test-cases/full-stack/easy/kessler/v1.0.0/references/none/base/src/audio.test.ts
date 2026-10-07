// The per-screen bed rule (specs/assets.md "The music beds").

import { describe, expect, it } from "vitest";
import { bedForScreen } from "./audio";

describe("bedForScreen", () => {
  it("loops the title bed on title and howto", () => {
    expect(bedForScreen("title")).toBe("music-title");
    expect(bedForScreen("howto")).toBe("music-title");
  });

  it("loops the play bed on playing, waveclear, and paused", () => {
    expect(bedForScreen("playing")).toBe("music-play");
    expect(bedForScreen("waveclear")).toBe("music-play");
    expect(bedForScreen("paused")).toBe("music-play");
  });

  it("plays no bed on gameover, so the cue rings out over silence", () => {
    expect(bedForScreen("gameover")).toBe(null);
  });
});
