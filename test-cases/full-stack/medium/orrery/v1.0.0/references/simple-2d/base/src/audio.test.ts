// The cue bus, as Orrery declares it (specs/ui.md "Audio", specs/assets.md
// "The sound").
//
// The bus is the engine's, so what is checked here is Orrery's half: that all
// seven cues in `CUES` are declared before a frame can play one, that each is
// then bound to the produced file `CUE_PATHS` names, that a load which fails
// leaves the name declared and the game playable, and that the bed loops on
// every frame without being restarted.

import type { CueSpec } from "@clockwyrks/simple-2d";
import { describe, expect, it } from "vitest";

import { CUE_FALLBACKS, defineCues, playCues, syncBed } from "./audio";
import { CUES, CUE_PATHS } from "./constants";
import { CUE_NAMES, type Cue } from "./figures";

/** An audio api that records every declaration and load it was given. */
function bus(fails: (cue: string) => boolean = () => false) {
  const defined = new Map<string, CueSpec>();
  const loaded: [string, string][] = [];
  return {
    defined,
    loaded,
    api: {
      audio: {
        define: (cue: string, spec: CueSpec) => defined.set(cue, spec),
        load: (cue: string, path: string): Promise<void> => {
          if (fails(cue)) return Promise.reject(new Error("404"));
          loaded.push([cue, path]);
          return Promise.resolve();
        },
      },
    },
  };
}

/** An update-time audio api that records what a frame played and looped. */
function frameBus(looping: string[] = []) {
  const played: string[] = [];
  const loops: string[] = [];
  return {
    played,
    loops,
    api: {
      audio: {
        play: (cue: string) => played.push(cue),
        loop: (cue: string) => {
          loops.push(cue);
          looping.push(cue);
        },
        stop: () => undefined,
        looping: (cue: string) => looping.includes(cue),
        setMuted: () => undefined,
        muted: () => false,
      },
    },
  };
}

describe("declaring the cues (specs/ui.md)", () => {
  it("declares all seven, and binds each to its produced file", async () => {
    const { api, defined, loaded } = bus();
    await defineCues(api);
    expect([...defined.keys()].sort()).toEqual([...CUE_NAMES].sort());
    expect(loaded.sort()).toEqual(
      CUE_NAMES.map((cue) => [cue, CUE_PATHS[cue]] as [string, string]).sort(),
    );
  });

  it("declares a shape before loading, so a failed load stays playable", async () => {
    const { api, defined } = bus(() => true);
    await expect(defineCues(api)).resolves.toBeUndefined();
    expect([...defined.keys()].sort()).toEqual([...CUE_NAMES].sort());
  });

  it("gives every cue a shape a player can tell from its neighbours", () => {
    const shapes = CUE_NAMES.map((cue) => CUE_FALLBACKS[cue as Cue]);
    for (const shape of shapes) {
      expect(shape.durationMs).toBeGreaterThan(0);
      expect(shape.freq).toBeGreaterThan(0);
    }
    // `erase` is told from `place` by ear: it falls where `place` rises.
    expect(CUE_FALLBACKS[CUES.place].freqTo).toBeGreaterThan(
      CUE_FALLBACKS[CUES.place].freq,
    );
    expect(CUE_FALLBACKS[CUES.erase].freqTo).toBeLessThan(
      CUE_FALLBACKS[CUES.erase].freq,
    );
    // `halt` falls and `complete` rises, so neither is heard as the other.
    expect(CUE_FALLBACKS[CUES.halt].freqTo).toBeLessThan(
      CUE_FALLBACKS[CUES.halt].freq,
    );
    expect(CUE_FALLBACKS[CUES.complete].freqTo).toBeGreaterThan(
      CUE_FALLBACKS[CUES.complete].freq,
    );
    // The bed holds its pitch and sits under the cues.
    expect(CUE_FALLBACKS[CUES.music].freqTo).toBeUndefined();
    expect(CUE_FALLBACKS[CUES.music].gain).toBeLessThan(
      CUE_FALLBACKS[CUES.place].gain ?? 1,
    );
  });
});

describe("the bed and the one-shots (specs/ui.md)", () => {
  it("loops the bed on the first frame and never restarts it", () => {
    const live: string[] = [];
    const first = frameBus(live);
    syncBed(first.api);
    expect(first.loops).toEqual([CUES.music]);
    const second = frameBus(live);
    syncBed(second.api);
    expect(second.loops).toEqual([]);
  });

  it("plays each cue a frame raised, once, in the order asked", () => {
    const { api, played } = frameBus();
    playCues(api, [CUES.place, CUES.erase]);
    expect(played).toEqual([CUES.place, CUES.erase]);
  });
});
