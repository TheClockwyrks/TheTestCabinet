import { describe, expect, it } from "vitest";
import { AudioBus, DEFAULT_CUE_GAIN, platformAudioContext } from "./audio-bus";

/** One node the fake context handed out, with what was done to it. */
interface FakeNode {
  kind: "gain" | "source";
  gain: { value: number };
  buffer: unknown;
  loop: boolean;
  started: number;
  stopped: number;
  connectedTo: FakeNode | "destination" | null;
}

/** A Web Audio context that records rather than sounds. */
class FakeContext {
  readonly nodes: FakeNode[] = [];
  readonly destination = "destination" as const;
  decoded: string[] = [];
  closed = false;
  /** Whether `decodeAudioData` refuses everything, as a corrupt file would. */
  reject = false;

  createGain(): FakeNode {
    return this.node("gain");
  }

  createBufferSource(): FakeNode {
    return this.node("source");
  }

  decodeAudioData(bytes: ArrayBuffer): Promise<AudioBuffer> {
    this.decoded.push(String(bytes.byteLength));
    if (this.reject) return Promise.reject(new Error("bad wav"));
    return Promise.resolve({
      length: bytes.byteLength,
    } as unknown as AudioBuffer);
  }

  resume(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }

  /** The sources that were actually started. */
  played(): FakeNode[] {
    return this.nodes.filter(
      (node) => node.kind === "source" && node.started > 0,
    );
  }

  private node(kind: FakeNode["kind"]): FakeNode {
    const node: FakeNode = {
      kind,
      gain: { value: 1 },
      buffer: null,
      loop: false,
      started: 0,
      stopped: 0,
      connectedTo: null,
    };
    Object.assign(node, {
      connect(to: FakeNode | "destination") {
        node.connectedTo = to;
        return to;
      },
      disconnect() {
        node.connectedTo = null;
      },
      start() {
        node.started += 1;
      },
      stop() {
        node.stopped += 1;
      },
    });
    this.nodes.push(node);
    return node;
  }
}

/** A bus over a fake context, with bytes for every key it is given. */
function bus(keys: readonly string[], context = new FakeContext()) {
  const bytes = new Map(keys.map((key) => [key, new ArrayBuffer(key.length)]));
  const made = new AudioBus(
    (key) => bytes.get(key) ?? null,
    () => context as unknown as AudioContext,
  );
  return { made, context };
}

/** Open the context the way a first gesture does. */
function unlock(made: AudioBus, target: EventTarget): void {
  made.armUnlock(target);
  target.dispatchEvent(new Event("pointerdown"));
}

describe("AudioBus", () => {
  it("stays locked until a gesture, and is silent while it is", () => {
    const { made, context } = bus(["select"]);
    made.define("select", { layers: ["select"] });
    expect(made.unlocked()).toBe(false);
    made.play("select");
    expect(context.played()).toHaveLength(0);
  });

  it("opens the context on the first gesture and only then", () => {
    const target = new EventTarget();
    const { made } = bus(["select"]);
    made.armUnlock(target);
    expect(made.unlocked()).toBe(false);
    target.dispatchEvent(new Event("keydown"));
    expect(made.unlocked()).toBe(true);
  });

  it("plays a declared cue's layer through a gain at the master", async () => {
    const target = new EventTarget();
    const { made, context } = bus(["select"]);
    made.define("select", { layers: ["select"] });
    unlock(made, target);
    made.prime(["select"]);
    await Promise.resolve();
    made.play("select");
    expect(context.played()).toHaveLength(1);
  });

  it("throws on a cue that was never declared", () => {
    const { made } = bus([]);
    expect(() => {
      made.play("nope");
    }).toThrow(/never defined/);
  });

  it("plays every layer of a cue together", async () => {
    const target = new EventTarget();
    const { made, context } = bus(["shatter", "chain-1"]);
    made.define("clear", { layers: ["shatter"], ladder: ["chain-1"] });
    unlock(made, target);
    made.prime(["shatter", "chain-1"]);
    await Promise.resolve();
    made.play("clear", 1);
    expect(context.played()).toHaveLength(2);
  });

  it("picks the ladder rung the variant names, clamped at both ends", async () => {
    const target = new EventTarget();
    // Distinct key lengths, so the buffer each play sounded names its rung.
    const rungs = ["a", "bb", "ccc"];
    const { made, context } = bus(rungs);
    made.define("clear", { layers: [], ladder: rungs });
    unlock(made, target);
    made.prime(rungs);
    await Promise.resolve();
    made.play("clear", 2);
    made.play("clear", 99);
    made.play("clear", -4);
    const rung = context
      .played()
      .map((node) => (node.buffer as { length: number }).length);
    expect(rung).toEqual([2, 3, 1]);
  });

  it("uses the cue's own gain, and the default when it names none", async () => {
    const target = new EventTarget();
    const { made, context } = bus(["a", "b"]);
    made.define("loud", { layers: ["a"], gain: 0.9 });
    made.define("plain", { layers: ["b"] });
    unlock(made, target);
    made.prime(["a", "b"]);
    await Promise.resolve();
    made.play("loud");
    made.play("plain");
    const gains = context.nodes
      .filter(
        (node) => node.kind === "gain" && node.connectedTo !== "destination",
      )
      .map((node) => node.gain.value);
    expect(gains).toContain(0.9);
    expect(gains).toContain(DEFAULT_CUE_GAIN);
  });

  it("mutes by zeroing the master rather than skipping the cue", async () => {
    const target = new EventTarget();
    const { made, context } = bus(["select"]);
    made.define("select", { layers: ["select"] });
    unlock(made, target);
    made.prime(["select"]);
    await Promise.resolve();
    made.setMuted(true);
    expect(made.muted()).toBe(true);
    made.play("select");
    expect(context.played()).toHaveLength(1);
    const master = context.nodes.find(
      (node) => node.connectedTo === "destination",
    );
    expect(master?.gain.value).toBe(0);
    made.setMuted(false);
    expect(master?.gain.value).toBe(1);
  });

  it("carries a mute set before the unlock onto the master it opens", () => {
    const target = new EventTarget();
    const { made, context } = bus(["select"]);
    made.setMuted(true);
    unlock(made, target);
    const master = context.nodes.find(
      (node) => node.connectedTo === "destination",
    );
    expect(master?.gain.value).toBe(0);
  });

  it("decodes each sound once, however often it is played or primed", async () => {
    const target = new EventTarget();
    const { made, context } = bus(["select"]);
    made.define("select", { layers: ["select"] });
    unlock(made, target);
    made.prime(["select"]);
    made.prime(["select"]);
    await Promise.resolve();
    made.play("select");
    made.play("select");
    expect(context.decoded).toEqual(["6"]);
  });

  it("degrades to silence when a sound will not decode", async () => {
    const context = new FakeContext();
    context.reject = true;
    const target = new EventTarget();
    const { made } = bus(["select"], context);
    made.define("select", { layers: ["select"] });
    unlock(made, target);
    made.prime(["select"]);
    await Promise.resolve();
    await Promise.resolve();
    expect(() => {
      made.play("select");
    }).not.toThrow();
    expect(context.played()).toHaveLength(0);
  });

  it("starts the bed it is asked for, looping, and swaps it on request", async () => {
    const target = new EventTarget();
    const { made, context } = bus(["title", "play"]);
    unlock(made, target);
    made.prime(["title", "play"]);
    await Promise.resolve();
    made.setTrack("title");
    expect(made.playing()).toBe("title");
    const first = context.played()[0];
    expect(first.loop).toBe(true);
    made.setTrack("title");
    expect(context.played()).toHaveLength(1);
    made.setTrack("play");
    expect(first.stopped).toBe(1);
    expect(made.playing()).toBe("play");
    made.setTrack(null);
    expect(made.playing()).toBeNull();
  });

  it("remembers a bed asked for before its bytes decoded", async () => {
    const target = new EventTarget();
    const { made } = bus(["title"]);
    unlock(made, target);
    made.setTrack("title");
    expect(made.playing()).toBeNull();
    made.prime(["title"]);
    await Promise.resolve();
    expect(made.playing()).toBe("title");
  });

  it("closes the context and stops the bed on dispose, twice over", async () => {
    const target = new EventTarget();
    const { made, context } = bus(["title"]);
    unlock(made, target);
    made.prime(["title"]);
    await Promise.resolve();
    made.setTrack("title");
    made.dispose();
    made.dispose();
    expect(context.closed).toBe(true);
    expect(made.playing()).toBeNull();
  });

  it("does nothing at all where the platform has no Web Audio", () => {
    const made = new AudioBus(
      () => new ArrayBuffer(2),
      () => null,
    );
    made.define("select", { layers: ["select"] });
    const target = new EventTarget();
    unlock(made, target);
    expect(made.unlocked()).toBe(false);
    expect(() => {
      made.play("select");
      made.setTrack("title");
      made.prime(["select"]);
    }).not.toThrow();
  });

  it("reports no context where the platform constructor is missing", () => {
    expect(platformAudioContext()).toBeNull();
  });
});
