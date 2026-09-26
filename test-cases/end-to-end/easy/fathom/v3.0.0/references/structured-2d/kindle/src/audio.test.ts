// Fathom — the cues the game declares, and how a tick sounds the ones it raised.

import { describe, expect, it } from "vitest";
import type { CueSpec, InitApi, WorldAudio } from "@clockwyrks/structured-2d";
import { CUES, type CueName } from "./constants";
import { CUE_SPECS, defineCues, noCues, playCues } from "./audio";

function recorder(): {
  api: Pick<InitApi, "audio">;
  defined: { cue: string; spec: CueSpec }[];
} {
  const defined: { cue: string; spec: CueSpec }[] = [];
  return {
    defined,
    api: {
      audio: {
        define: (cue, spec) => {
          defined.push({ cue, spec });
        },
        load: () => Promise.resolve(),
      },
    },
  };
}

function bus(): { audio: WorldAudio; played: string[] } {
  const played: string[] = [];
  const audio: WorldAudio = {
    play: (cue) => played.push(cue),
    loop: () => undefined,
    stop: () => undefined,
    looping: () => false,
    setMuted: () => undefined,
    muted: () => false,
  };
  return { audio, played };
}

describe("the cues the game declares", () => {
  it("defines exactly the seven the specification names, once each", () => {
    const { api, defined } = recorder();
    defineCues(api);
    expect(defined.map((entry) => entry.cue)).toEqual(Object.values(CUES));
    expect(new Set(defined.map((entry) => entry.cue)).size).toBe(7);
  });

  it("gives each of the seven a sound of its own", () => {
    const shapes = Object.values(CUES).map((cue) => {
      const spec = CUE_SPECS[cue];
      return `${spec.wave}:${String(spec.freq)}:${String(spec.freqTo)}`;
    });
    expect(new Set(shapes).size).toBe(7);
  });
});

describe("the cues one tick raised", () => {
  it("sounds nothing when the tick raised nothing", () => {
    const { audio, played } = bus();
    playCues(audio, noCues());
    expect(played).toEqual([]);
  });

  it("sounds a cue once however many times the tick raised it", () => {
    const { audio, played } = bus();
    const bag = noCues();
    bag.add(CUES.predatorPing);
    bag.add(CUES.predatorPing);
    bag.add(CUES.predatorPing);
    playCues(audio, bag);
    expect(played).toEqual([CUES.predatorPing]);
  });

  it("sounds each of several once, in the order the cues are declared in", () => {
    const { audio, played } = bus();
    const bag = noCues();
    for (const cue of [CUES.descend, CUES.eat, CUES.flare] as CueName[]) {
      bag.add(cue);
    }
    expect(played).toEqual([]);
    playCues(audio, bag);
    expect(played).toEqual([CUES.eat, CUES.flare, CUES.descend]);
  });
});
