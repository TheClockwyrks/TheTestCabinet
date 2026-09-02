import { describe, expect, it } from "vitest";
import type { CueSpec, WorldAudio } from "@test-cabinet/structured-2d";

import { CUE_FALLBACKS, defineCues, looping, syncBed } from "./audio";
import { CUES, CUE_PATHS, LOOPING_CUES } from "./constants";
import { CUE_NAMES } from "./figures";

/** An audio seam recording every declaration and load asked of it. */
function audioApi(fail = false): {
  api: Parameters<typeof defineCues>[0];
  defined: Map<string, CueSpec>;
  loaded: [string, string][];
} {
  const defined = new Map<string, CueSpec>();
  const loaded: [string, string][] = [];
  return {
    defined,
    loaded,
    api: {
      audio: {
        define: (cue, spec) => defined.set(cue, spec),
        load: (cue, path) => {
          loaded.push([cue, path]);
          return fail
            ? Promise.reject(new Error("no fetch"))
            : Promise.resolve();
        },
      },
    },
  };
}

/** A cue bus recording what it was asked to loop and stop. */
function bus(): { audio: WorldAudio; looped: string[]; stopped: string[] } {
  const looped: string[] = [];
  const stopped: string[] = [];
  const running = new Set<string>();
  return {
    looped,
    stopped,
    audio: {
      play: () => undefined,
      loop: (cue) => {
        if (!running.has(cue)) {
          running.add(cue);
          looped.push(cue);
        }
      },
      stop: (cue) => {
        if (running.delete(cue)) stopped.push(cue);
      },
      looping: (cue) => running.has(cue),
      setMuted: () => undefined,
      muted: () => false,
    },
  };
}

describe("the seven cues (specs/ui.md, specs/assets.md)", () => {
  it("carries a synthesized shape for every one of them", () => {
    expect(Object.keys(CUE_FALLBACKS).sort()).toEqual([...CUE_NAMES].sort());
    for (const cue of CUE_NAMES) {
      const spec = CUE_FALLBACKS[cue];
      expect(spec.freq, cue).toBeGreaterThan(0);
      expect(spec.durationMs, cue).toBeGreaterThan(0);
    }
  });

  it("declares each shape first, then loads the produced file over it", async () => {
    const wired = audioApi();
    await defineCues(wired.api);
    expect([...wired.defined.keys()].sort()).toEqual([...CUE_NAMES].sort());
    expect(wired.loaded.sort()).toEqual(
      CUE_NAMES.map((cue) => [cue, CUE_PATHS[cue]] as [string, string]).sort(),
    );
  });

  it("leaves every name playable when the produced file will not load", async () => {
    const wired = audioApi(true);
    await expect(defineCues(wired.api)).resolves.toBeUndefined();
    expect(wired.defined.size).toBe(CUE_NAMES.length);
  });

  it("names the one cue that loops", () => {
    expect(LOOPING_CUES).toEqual([CUES.music]);
    expect(looping(CUES.music)).toBe(true);
    expect(looping(CUES.place)).toBe(false);
  });

  it("keeps the bed looping, idempotently, however often it is reconciled", () => {
    const wired = bus();
    syncBed(wired.audio);
    syncBed(wired.audio);
    syncBed(wired.audio);
    expect(wired.looped).toEqual([CUES.music]);
    expect(wired.stopped).toEqual([]);
  });
});
