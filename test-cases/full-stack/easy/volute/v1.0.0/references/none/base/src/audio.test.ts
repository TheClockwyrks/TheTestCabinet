import { describe, expect, it } from "vitest";
import { CUES } from "./constants";
import type { CueName } from "./constants";
import { AudioBus, platformAudioContext } from "./audio";

/** What a source node did, so a test can see what actually sounded. */
interface FakeSource {
  buffer: unknown;
  loop: boolean;
  started: boolean;
  stopped: boolean;
  connectedTo: unknown;
}

/** A Web Audio context small enough to check the bus against. */
function fakeContext() {
  const sources: FakeSource[] = [];
  const gains: { gain: { value: number }; connectedTo: unknown }[] = [];
  let closed = false;
  const context = {
    currentTime: 0,
    destination: { name: "destination" },
    sources,
    gains,
    closed: () => closed,
    createGain() {
      const node = {
        gain: { value: 1 },
        connectedTo: null as unknown,
        connect(target: unknown) {
          node.connectedTo = target;
          return target;
        },
        disconnect() {},
      };
      gains.push(node);
      return node;
    },
    createBufferSource() {
      const node: FakeSource & {
        connect(target: unknown): unknown;
        start(): void;
        stop(): void;
        disconnect(): void;
      } = {
        buffer: null,
        loop: false,
        started: false,
        stopped: false,
        connectedTo: null,
        connect(target: unknown) {
          node.connectedTo = target;
          return target;
        },
        start() {
          node.started = true;
        },
        stop() {
          node.stopped = true;
        },
        disconnect() {},
      };
      sources.push(node);
      return node;
    },
    decodeAudioData(bytes: ArrayBuffer) {
      return Promise.resolve({ length: bytes.byteLength } as unknown);
    },
    resume: () => Promise.resolve(),
    close: () => {
      closed = true;
      return Promise.resolve();
    },
  };
  return context;
}

/** A full set of produced files, as bytes. */
function files(): Record<CueName, ArrayBuffer | null> {
  const out = {} as Record<CueName, ArrayBuffer | null>;
  for (const cue of CUES) out[cue] = new ArrayBuffer(8);
  return out;
}

/** A bus whose context is already open and whose cues are already decoded. */
async function ready() {
  const context = fakeContext();
  const bus = new AudioBus(() => context as unknown as AudioContext);
  bus.load(files());
  const target = new EventTarget();
  bus.armUnlock(target);
  target.dispatchEvent(new Event("keydown"));
  // The decode is a promise; let it settle before anything asks for a sound.
  await Promise.resolve();
  await Promise.resolve();
  return { bus, context };
}

describe("the audio bus", () => {
  it("stays silent until a gesture opens the context", () => {
    const context = fakeContext();
    const bus = new AudioBus(() => context as unknown as AudioContext);
    bus.load(files());
    expect(bus.unlocked()).toBe(false);
    bus.play("fire");
    expect(context.sources).toHaveLength(0);
  });

  it("opens the context on the first gesture", () => {
    const context = fakeContext();
    const bus = new AudioBus(() => context as unknown as AudioContext);
    const target = new EventTarget();
    bus.armUnlock(target);
    target.dispatchEvent(new Event("pointerdown"));
    expect(bus.unlocked()).toBe(true);
  });

  it("plays a one-shot cue through the master gain", async () => {
    const { bus, context } = await ready();
    bus.play("seat");
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].started).toBe(true);
    expect(context.sources[0].loop).toBe(false);
  });

  it("loops a bed until it is stopped, and only once", async () => {
    const { bus, context } = await ready();
    bus.loop("hall-loop");
    bus.loop("hall-loop");
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].loop).toBe(true);
    expect(bus.looping("hall-loop")).toBe(true);
    bus.stop("hall-loop");
    expect(context.sources[0].stopped).toBe(true);
    expect(bus.looping("hall-loop")).toBe(false);
    bus.stop("hall-loop");
  });

  it("mutes by taking the master gain to zero, leaving the bed running", async () => {
    const { bus, context } = await ready();
    bus.loop("danger-loop");
    const master = context.gains[0];
    expect(master.gain.value).toBe(1);
    bus.setMuted(true);
    expect(bus.muted()).toBe(true);
    expect(master.gain.value).toBe(0);
    expect(bus.looping("danger-loop")).toBe(true);
    expect(context.sources[0].stopped).toBe(false);
    bus.setMuted(false);
    expect(master.gain.value).toBe(1);
  });

  it("opens muted when the mute was set before the gesture", () => {
    const context = fakeContext();
    const bus = new AudioBus(() => context as unknown as AudioContext);
    bus.setMuted(true);
    const target = new EventTarget();
    bus.armUnlock(target);
    target.dispatchEvent(new Event("keydown"));
    expect(context.gains[0].gain.value).toBe(0);
  });

  it("stays silent for a cue whose file never arrived", async () => {
    const context = fakeContext();
    const bus = new AudioBus(() => context as unknown as AudioContext);
    const empty = files();
    empty.fire = null;
    bus.load(empty);
    const target = new EventTarget();
    bus.armUnlock(target);
    target.dispatchEvent(new Event("keydown"));
    await Promise.resolve();
    await Promise.resolve();
    bus.play("fire");
    expect(context.sources).toHaveLength(0);
  });

  it("degrades to silence where the platform has no audio", () => {
    const bus = new AudioBus(() => null);
    bus.load(files());
    const target = new EventTarget();
    bus.armUnlock(target);
    target.dispatchEvent(new Event("keydown"));
    expect(bus.unlocked()).toBe(false);
    bus.play("fire");
    bus.loop("hall-loop");
    expect(bus.looping("hall-loop")).toBe(false);
  });

  it("stops every loop and closes the context when it is disposed", async () => {
    const { bus, context } = await ready();
    bus.loop("hall-loop");
    bus.dispose();
    expect(bus.looping("hall-loop")).toBe(false);
    expect(context.closed()).toBe(true);
  });

  it("decodes files handed to it after the context opened", async () => {
    const context = fakeContext();
    const bus = new AudioBus(() => context as unknown as AudioContext);
    const target = new EventTarget();
    bus.armUnlock(target);
    target.dispatchEvent(new Event("keydown"));
    bus.load(files());
    await Promise.resolve();
    await Promise.resolve();
    bus.play("swap");
    expect(context.sources).toHaveLength(1);
  });

  it("reports no context where the platform defines none", () => {
    expect(platformAudioContext()).toBeNull();
  });
});
