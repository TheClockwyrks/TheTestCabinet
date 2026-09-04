import { afterEach, describe, expect, it, vi } from "vitest";

import { AudioBus } from "./audio";
import { CUES } from "./constants";

interface FakeSource {
  buffer: unknown;
  loop: boolean;
  started: boolean;
  stopped: boolean;
  bus: string;
}

/** A Web Audio graph small enough to assert against. */
function fakeAudio(): { sources: FakeSource[]; gains: { value: number }[] } {
  const sources: FakeSource[] = [];
  const gains: { value: number }[] = [];
  class FakeContext {
    state = "suspended";
    destination = { name: "destination" };
    resumed = 0;
    createGain(): unknown {
      const gain = { value: 1 };
      gains.push(gain);
      return { gain, connect: () => undefined, name: `gain${gains.length}` };
    }
    createBufferSource(): unknown {
      const source: FakeSource = {
        buffer: null,
        loop: false,
        started: false,
        stopped: false,
        bus: "",
      };
      sources.push(source);
      return {
        set buffer(value: unknown) {
          source.buffer = value;
        },
        set loop(value: boolean) {
          source.loop = value;
        },
        connect: (target: { name: string }) => {
          source.bus = target.name;
        },
        start: () => {
          source.started = true;
        },
        stop: () => {
          source.stopped = true;
        },
      };
    }
    decodeAudioData(bytes: ArrayBuffer): Promise<unknown> {
      return Promise.resolve({ bytes });
    }
    resume(): Promise<void> {
      this.state = "running";
      return Promise.resolve();
    }
  }
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) })),
  );
  return { sources, gains };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the audio bus (specs/ui.md, specs/assets.md)", () => {
  it("stays silent and fully usable with no Web Audio at all", async () => {
    vi.stubGlobal("AudioContext", undefined);
    const bus = new AudioBus();
    await bus.load({ place: "place.wav" });
    expect(() => bus.play(CUES.place)).not.toThrow();
    expect(() => bus.loopMusic()).not.toThrow();
    bus.unlock();
    expect(bus.muted()).toBe(false);
  });

  it("decodes each produced sound and plays a cue through the cue bus", async () => {
    const audio = fakeAudio();
    const bus = new AudioBus();
    await bus.load({ place: "place.wav", music: "music.wav" });
    bus.play(CUES.place);
    expect(audio.sources).toHaveLength(1);
    expect(audio.sources[0].started).toBe(true);
    expect(audio.sources[0].loop).toBe(false);
  });

  it("loops the bed, and keeps exactly one running", async () => {
    const audio = fakeAudio();
    const bus = new AudioBus();
    await bus.load({ music: "music.wav" });
    bus.loopMusic();
    bus.loopMusic();
    expect(audio.sources.filter((source) => source.loop)).toHaveLength(1);
    bus.syncBed(null);
    expect(audio.sources[0].stopped).toBe(true);
  });

  it("plays a looping cue as the bed rather than as a one-shot", async () => {
    const audio = fakeAudio();
    const bus = new AudioBus();
    await bus.load({ music: "music.wav" });
    bus.play(CUES.music);
    expect(audio.sources).toHaveLength(1);
    expect(audio.sources[0].loop).toBe(true);
  });

  it("carries a bed asked for before its clip decoded", async () => {
    const audio = fakeAudio();
    const bus = new AudioBus();
    bus.syncBed(CUES.music);
    expect(audio.sources).toHaveLength(0);
    await bus.load({ music: "music.wav" });
    expect(audio.sources.filter((source) => source.loop)).toHaveLength(1);
  });

  it("mutes the whole graph with one bit, and keeps the game playable", async () => {
    const audio = fakeAudio();
    const bus = new AudioBus();
    await bus.load({ place: "place.wav" });
    const master = audio.gains[0];
    expect(master.value).toBe(1);
    bus.toggleMuted();
    expect(bus.muted()).toBe(true);
    expect(master.value).toBe(0);
    bus.play(CUES.place);
    expect(audio.sources).toHaveLength(1);
    bus.setMuted(false);
    expect(master.value).toBe(1);
  });

  it("remembers a mute set before the graph existed", async () => {
    const audio = fakeAudio();
    const bus = new AudioBus();
    bus.setMuted(true);
    await bus.load({ place: "place.wav" });
    expect(audio.gains[0].value).toBe(0);
  });

  it("stays silent for a sound whose file will not load", async () => {
    const audio = fakeAudio();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("404");
      }),
    );
    const bus = new AudioBus();
    await bus.load({ place: "place.wav" });
    bus.play(CUES.place);
    expect(audio.sources).toHaveLength(0);
  });

  it("resumes the context on the first gesture, which browsers wait for", async () => {
    fakeAudio();
    const bus = new AudioBus();
    await bus.load({});
    expect(() => bus.unlock()).not.toThrow();
  });
});
