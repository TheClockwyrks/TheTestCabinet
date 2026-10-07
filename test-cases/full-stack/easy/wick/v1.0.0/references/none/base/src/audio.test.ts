import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebAudioBus } from "./audio";
import { CUES, CUE_NAMES, type Cue } from "./constants";

/** A source node as the bus drives it. */
interface FakeSource {
  buffer: unknown;
  loop: boolean;
  connectedTo: unknown;
  started: number;
  stopped: number;
  connect(node: unknown): void;
  start(): void;
  stop(): void;
}

interface FakeGain {
  gain: { value: number };
  connectedTo: unknown;
  connect(node: unknown): void;
}

/** The Web Audio graph the bus builds, recorded for the tests to read. */
class FakeContext {
  static instances: FakeContext[] = [];
  static failing = false;
  state = "suspended";
  resumed = 0;
  readonly destination = { kind: "destination" };
  readonly gains: FakeGain[] = [];
  readonly sources: FakeSource[] = [];

  constructor() {
    if (FakeContext.failing) throw new Error("no audio here");
    FakeContext.instances.push(this);
  }

  resume(): Promise<void> {
    this.resumed += 1;
    this.state = "running";
    return Promise.resolve();
  }

  createGain(): FakeGain {
    const gain: FakeGain = {
      gain: { value: 1 },
      connectedTo: null,
      connect(node) {
        gain.connectedTo = node;
      },
    };
    this.gains.push(gain);
    return gain;
  }

  createBufferSource(): FakeSource {
    const source: FakeSource = {
      buffer: null,
      loop: false,
      connectedTo: null,
      started: 0,
      stopped: 0,
      connect(node) {
        source.connectedTo = node;
      },
      start() {
        source.started += 1;
      },
      stop() {
        source.stopped += 1;
      },
    };
    this.sources.push(source);
    return source;
  }

  decodeAudioData(bytes: ArrayBuffer): Promise<{ bytes: ArrayBuffer }> {
    if (bytes.byteLength === 0) return Promise.reject(new Error("undecodable"));
    return Promise.resolve({ bytes });
  }
}

const globals = globalThis as {
  AudioContext?: unknown;
  fetch?: unknown;
};
const original = { AudioContext: globals.AudioContext, fetch: globals.fetch };

/** Every cue's URL, keyed by cue; a URL ending in `empty` yields no bytes. */
function urls(): Map<Cue, string> {
  return new Map(CUE_NAMES.map((cue) => [cue, `audio/${cue}.wav`]));
}

beforeEach(() => {
  FakeContext.instances = [];
  FakeContext.failing = false;
  globals.AudioContext = FakeContext;
  globals.fetch = (url: string) =>
    Promise.resolve({
      arrayBuffer: () =>
        Promise.resolve(new ArrayBuffer(url.includes("empty") ? 0 : 4)),
    });
});

afterEach(() => {
  globals.AudioContext = original.AudioContext;
  globals.fetch = original.fetch;
});

/** The master, cue, and loop gains, in the order the bus builds them. */
function graph(context: FakeContext): {
  master: FakeGain;
  cueBus: FakeGain;
  loopBus: FakeGain;
} {
  const [master, cueBus, loopBus] = context.gains;
  return { master, cueBus, loopBus };
}

describe("the Web Audio bus", () => {
  it("builds the graph, decodes every cue, and plays a one-shot on the cue bus", async () => {
    const bus = new WebAudioBus();
    await bus.load(urls());
    const [context] = FakeContext.instances;
    const { master, cueBus, loopBus } = graph(context);
    expect(master.connectedTo).toBe(context.destination);
    expect(cueBus.connectedTo).toBe(master);
    expect(loopBus.connectedTo).toBe(master);
    bus.play(CUES.hit);
    expect(context.sources).toHaveLength(1);
    const [source] = context.sources;
    expect(source.loop).toBe(false);
    expect(source.connectedTo).toBe(cueBus);
    expect(source.started).toBe(1);
    expect(bus.looping()).toEqual([]);
  });

  it("refuses to play a looping cue as a one-shot", async () => {
    const bus = new WebAudioBus();
    await bus.load(urls());
    bus.play(CUES.music);
    bus.play(CUES.hum);
    expect(FakeContext.instances[0].sources).toHaveLength(0);
  });

  it("keeps exactly the wanted cues looping through one source each", async () => {
    const bus = new WebAudioBus();
    await bus.load(urls());
    const [context] = FakeContext.instances;
    const { loopBus } = graph(context);
    bus.syncLoops(new Set([CUES.music]));
    bus.syncLoops(new Set([CUES.music]));
    expect(bus.looping()).toEqual([CUES.music]);
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].loop).toBe(true);
    expect(context.sources[0].connectedTo).toBe(loopBus);
    bus.syncLoops(new Set([CUES.music, CUES.hum]));
    expect(bus.looping().sort()).toEqual([CUES.hum, CUES.music]);
    expect(context.sources).toHaveLength(2);
    bus.syncLoops(new Set([CUES.hum]));
    expect(bus.looping()).toEqual([CUES.hum]);
    expect(context.sources[0].stopped).toBe(1);
    expect(context.sources[1].stopped).toBe(0);
    bus.syncLoops(new Set());
    expect(bus.looping()).toEqual([]);
    expect(context.sources[1].stopped).toBe(1);
  });

  it("starts a loop wanted before its clip decoded once the clip arrives", async () => {
    const bus = new WebAudioBus();
    bus.syncLoops(new Set([CUES.music]));
    expect(bus.looping()).toEqual([]);
    await bus.load(urls());
    expect(bus.looping()).toEqual([CUES.music]);
    expect(FakeContext.instances[0].sources).toHaveLength(1);
  });

  it("mutes through the master gain without stopping a loop", async () => {
    const bus = new WebAudioBus();
    expect(bus.muted).toBe(false);
    bus.muted = true;
    await bus.load(urls());
    const [context] = FakeContext.instances;
    const { master } = graph(context);
    expect(master.gain.value).toBe(0);
    bus.syncLoops(new Set([CUES.hum]));
    bus.muted = false;
    expect(master.gain.value).toBe(1);
    expect(bus.looping()).toEqual([CUES.hum]);
    expect(context.sources[0].stopped).toBe(0);
    bus.muted = true;
    expect(master.gain.value).toBe(0);
    expect(bus.looping()).toEqual([CUES.hum]);
  });

  it("resumes a suspended context on unlock", async () => {
    const bus = new WebAudioBus();
    bus.unlock();
    await bus.load(urls());
    const [context] = FakeContext.instances;
    bus.unlock();
    expect(context.resumed).toBe(1);
    bus.unlock();
    expect(context.resumed).toBe(1);
  });

  it("stays silent and playable when a clip will not decode or is unnamed", async () => {
    const bus = new WebAudioBus();
    const partial = urls();
    partial.set(CUES.gem, "audio/empty.wav");
    partial.delete(CUES.kill);
    await bus.load(partial);
    const [context] = FakeContext.instances;
    bus.play(CUES.gem);
    bus.play(CUES.kill);
    expect(context.sources).toHaveLength(0);
    bus.play(CUES.hit);
    expect(context.sources).toHaveLength(1);
  });

  it("stays silent and playable when there is no audio context", async () => {
    FakeContext.failing = true;
    const bus = new WebAudioBus();
    await bus.load(urls());
    bus.unlock();
    bus.play(CUES.hit);
    bus.syncLoops(new Set([CUES.music]));
    bus.muted = true;
    expect(bus.muted).toBe(true);
    expect(bus.looping()).toEqual([]);
  });
});
