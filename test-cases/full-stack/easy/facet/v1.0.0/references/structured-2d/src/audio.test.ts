// The cues, the ladder, and the two beds.

import { describe, expect, it, vi } from "vitest";
import type { WorldAudio } from "@clockwyrks/structured-2d";
import {
  cueFiles,
  cueSpecs,
  defineCues,
  ladderCue,
  loadCues,
  musicForScreen,
  MUSIC_PLAY,
  MUSIC_TITLE,
  playFrameEvents,
  updateMusic,
} from "./audio";
import { CUES, MAX_MULTIPLIER } from "./constants";
import { NO_EVENTS } from "./core";

function fakeBus(): WorldAudio & { played: string[]; looping_: Set<string> } {
  const played: string[] = [];
  const looping_ = new Set<string>();
  let muted = false;
  return {
    played,
    looping_,
    play: (cue) => played.push(cue),
    loop: (cue) => looping_.add(cue),
    stop: (cue) => looping_.delete(cue),
    looping: (cue) => looping_.has(cue),
    setMuted: (next) => {
      muted = next;
    },
    muted: () => muted,
  };
}

describe("the cue table", () => {
  it("declares the nine names specs/ui.md fixes, over produced files", () => {
    const files = cueFiles();
    expect(Object.values(CUES)).toHaveLength(9);
    for (const cue of Object.values(CUES)) {
      expect(files[cue]).toMatch(/^audio\/.+\.wav$/);
    }
    expect(files[CUES.land]).toBe("audio/land.wav");
  });

  it("declares every ladder rung and both beds", () => {
    const files = cueFiles();
    for (let rung = 1; rung <= MAX_MULTIPLIER; rung += 1) {
      expect(files[ladderCue(rung)]).toBe(`audio/chain-${rung}.wav`);
    }
    expect(files[MUSIC_TITLE]).toBe("audio/title.wav");
    expect(files[MUSIC_PLAY]).toBe("audio/play.wav");
  });

  it("carries a placeholder spec for every name it loads a file for", () => {
    expect(Object.keys(cueSpecs()).sort()).toEqual(
      Object.keys(cueFiles()).sort(),
    );
  });

  it("climbs the ladder in pitch, and clamps at both ends", () => {
    const specs = cueSpecs();
    for (let rung = 2; rung <= MAX_MULTIPLIER; rung += 1) {
      expect(specs[ladderCue(rung)].freq).toBeGreaterThan(
        specs[ladderCue(rung - 1)].freq,
      );
    }
    expect(ladderCue(0)).toBe("chain-1");
    expect(ladderCue(99)).toBe(`chain-${MAX_MULTIPLIER}`);
  });
});

describe("declaring and loading", () => {
  it("defines every name synchronously, before any file lands", () => {
    const define = vi.fn();
    defineCues({ audio: { define, load: vi.fn() } });
    expect(define).toHaveBeenCalledTimes(Object.keys(cueSpecs()).length);
    expect(define).toHaveBeenCalledWith(CUES.select, cueSpecs()[CUES.select]);
  });

  it("binds the produced file over each name", async () => {
    const load = vi.fn().mockResolvedValue(undefined);
    await loadCues({ audio: { define: vi.fn(), load } });
    expect(load).toHaveBeenCalledTimes(Object.keys(cueFiles()).length);
    expect(load).toHaveBeenCalledWith(CUES.clear, "audio/shatter.wav");
  });

  it("leaves a name on its placeholder when its file will not load", async () => {
    const load = vi.fn().mockRejectedValue(new Error("no audio context"));
    await expect(
      loadCues({ audio: { define: vi.fn(), load } }),
    ).resolves.toBeUndefined();
  });
});

describe("playing a frame", () => {
  it("plays one cue per event, and nothing for a quiet frame", () => {
    const bus = fakeBus();
    playFrameEvents(bus, NO_EVENTS, 0);
    expect(bus.played).toEqual([]);

    playFrameEvents(
      bus,
      { ...NO_EVENTS, select: true, swap: true, refuse: true },
      0,
    );
    expect(bus.played).toEqual([CUES.select, CUES.swap, CUES.refuse]);
  });

  it("lays the ladder's rung over the body on a clear", () => {
    const bus = fakeBus();
    playFrameEvents(bus, { ...NO_EVENTS, clear: true }, 3);
    expect(bus.played).toEqual([CUES.clear, "chain-3"]);
  });

  it("holds on the top rung once the multiplier has capped", () => {
    const bus = fakeBus();
    playFrameEvents(bus, { ...NO_EVENTS, clear: true }, 40);
    expect(bus.played).toEqual([CUES.clear, `chain-${MAX_MULTIPLIER}`]);
  });

  it("plays the remaining five events under their own names", () => {
    const bus = fakeBus();
    playFrameEvents(
      bus,
      {
        ...NO_EVENTS,
        land: true,
        flaw: true,
        cut: true,
        levelUp: true,
        gameOver: true,
      },
      0,
    );
    expect(bus.played).toEqual([
      CUES.land,
      CUES.flaw,
      CUES.cut,
      CUES.levelUp,
      CUES.gameOver,
    ]);
  });
});

describe("the beds", () => {
  it("puts the title theme under the two menu screens", () => {
    expect(musicForScreen("title")).toBe(MUSIC_TITLE);
    expect(musicForScreen("howto")).toBe(MUSIC_TITLE);
    expect(musicForScreen("playing")).toBe(MUSIC_PLAY);
    expect(musicForScreen("paused")).toBe(MUSIC_PLAY);
    expect(musicForScreen("levelclear")).toBe(MUSIC_PLAY);
    expect(musicForScreen("gameover")).toBe(MUSIC_PLAY);
  });

  it("keeps exactly one looping, and swaps it with the screen", () => {
    const bus = fakeBus();
    updateMusic(bus, "title");
    expect([...bus.looping_]).toEqual([MUSIC_TITLE]);
    updateMusic(bus, "title");
    expect([...bus.looping_]).toEqual([MUSIC_TITLE]);
    updateMusic(bus, "playing");
    expect([...bus.looping_]).toEqual([MUSIC_PLAY]);
  });
});
