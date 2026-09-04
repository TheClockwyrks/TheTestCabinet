// The audio bus: what a cue does, what the one loop does, when sound may start
// at all, and what mute silences (`specs/ui.md`, `specs/assets.md`).

import { describe, expect, it } from "vitest";
import { CUES, type CueName } from "./constants";
import {
  AudioBus,
  audioSinkOver,
  MUSIC_NAME,
  MOTOR_GAIN,
  MUSIC_GAIN,
  webAudioSink,
  type AudioSink,
} from "./runtime-audio";

/** A sink that records instead of sounding. */
interface Recording extends AudioSink {
  readonly played: string[];
  readonly loops: string[];
  readonly stopped: string[];
  readonly gains: Map<string, number>;
  readonly names: string[];
  muted: boolean;
  loaded: boolean;
  settle(): Promise<void>;
}

function recordingSink(fail = false): Recording {
  let resolve = (): void => {};
  const done = new Promise<void>((r) => {
    resolve = r;
  });
  const sink: Recording = {
    played: [],
    loops: [],
    stopped: [],
    gains: new Map<string, number>(),
    names: [],
    muted: false,
    loaded: false,
    async load(sounds) {
      sink.names.push(...sounds.keys());
      sink.loaded = true;
      resolve();
      if (fail) throw new Error("undecodable");
    },
    play(name, gain) {
      sink.played.push(name);
      sink.gains.set(name, gain);
    },
    startLoop(name, gain) {
      if (sink.loops.includes(name)) return;
      sink.loops.push(name);
      sink.gains.set(name, gain);
    },
    stopLoop(name) {
      sink.stopped.push(name);
      const at = sink.loops.indexOf(name);
      if (at >= 0) sink.loops.splice(at, 1);
    },
    setMuted(muted) {
      sink.muted = muted;
    },
    async settle() {
      await done;
      // Two turns of the microtask queue: the load's own, and the `then` the
      // bus chained onto it.
      await Promise.resolve();
      await Promise.resolve();
    },
  };
  return sink;
}

const bytes = (n: number): ArrayBuffer => new ArrayBuffer(n);

const producedCues = (): Record<CueName, ArrayBuffer> => {
  const cues = {} as Record<CueName, ArrayBuffer>;
  CUES.forEach((cue, i) => {
    cues[cue] = bytes(i + 1);
  });
  return cues;
};

/** A bus with its sounds installed and the page interacted with. */
async function openBus(): Promise<{ bus: AudioBus; sink: Recording }> {
  const sink = recordingSink();
  const bus = new AudioBus(() => sink);
  bus.installAudio(producedCues(), bytes(99));
  bus.unlock();
  await sink.settle();
  return { bus, sink };
}

describe("opening the bus", () => {
  it("does not start before the player's first interaction", async () => {
    const sink = recordingSink();
    let opened = 0;
    const bus = new AudioBus(() => {
      opened += 1;
      return sink;
    });
    bus.installAudio(producedCues(), bytes(4));
    expect(opened).toBe(0);
    expect(sink.loaded).toBe(false);
    bus.playCue("place");
    expect(sink.played).toEqual([]);

    bus.unlock();
    await sink.settle();
    expect(opened).toBe(1);
    expect(sink.loaded).toBe(true);
  });

  it("opens once, however many interactions arrive", async () => {
    const sink = recordingSink();
    let opened = 0;
    const bus = new AudioBus(() => {
      opened += 1;
      return sink;
    });
    bus.unlock();
    bus.unlock();
    bus.installAudio(producedCues(), bytes(4));
    await sink.settle();
    bus.unlock();
    expect(opened).toBe(1);
  });

  it("loads every produced cue and the music bed", async () => {
    const { sink } = await openBus();
    for (const cue of CUES) expect(sink.names).toContain(cue);
    expect(sink.names).toContain(MUSIC_NAME);
    expect(sink.names).toHaveLength(CUES.length + 1);
  });

  it("holds the music bed once it is loaded", async () => {
    const { sink } = await openBus();
    expect(sink.loops).toEqual([MUSIC_NAME]);
    expect(sink.gains.get(MUSIC_NAME)).toBe(MUSIC_GAIN);
  });

  it("leaves the game playable when a sound will not decode", async () => {
    const sink = recordingSink(true);
    const bus = new AudioBus(() => sink);
    bus.installAudio(producedCues(), bytes(4));
    bus.unlock();
    await sink.settle();
    expect(bus.playable).toBe(false);
    bus.playCue("place");
    expect(sink.played).toEqual([]);
  });

  it("stays silent where there is no audio engine at all", () => {
    const bus = new AudioBus(() => null);
    bus.installAudio(producedCues(), bytes(4));
    bus.unlock();
    expect(() => {
      bus.playCue("break");
      bus.setMotor(true);
      bus.toggleMute();
    }).not.toThrow();
    expect(bus.playable).toBe(false);
  });

  it("takes the sounds after it opens, as readily as before", async () => {
    const sink = recordingSink();
    const bus = new AudioBus(() => sink);
    bus.unlock();
    expect(sink.loaded).toBe(false);
    bus.installAudio(producedCues(), bytes(4));
    await sink.settle();
    expect(bus.playable).toBe(true);
  });
});

describe("the cues", () => {
  it("plays each cue by name, once for the call", async () => {
    const { bus, sink } = await openBus();
    for (const cue of CUES) {
      if (cue === "motor") continue;
      bus.playCue(cue);
    }
    expect(sink.played).toEqual(CUES.filter((cue) => cue !== "motor"));
  });

  it("plays a cue once per raising, not once per run", async () => {
    const { bus, sink } = await openBus();
    bus.playCue("creak");
    bus.playCue("creak");
    expect(sink.played).toEqual(["creak", "creak"]);
  });

  it("leaves `motor` to the loop", async () => {
    const { bus, sink } = await openBus();
    bus.playCue("motor");
    expect(sink.played).toEqual([]);
    expect(sink.loops).toEqual([MUSIC_NAME]);
  });
});

describe("the motor loop", () => {
  it("runs while it is on and stops when it goes off", async () => {
    const { bus, sink } = await openBus();
    bus.setMotor(true);
    expect(sink.loops).toContain("motor");
    expect(sink.gains.get("motor")).toBe(MOTOR_GAIN);
    bus.setMotor(false);
    expect(sink.loops).not.toContain("motor");
    expect(sink.stopped).toEqual(["motor"]);
  });

  it("does nothing when set to what is already so", async () => {
    const { bus, sink } = await openBus();
    bus.setMotor(false);
    expect(sink.stopped).toEqual([]);
    bus.setMotor(true);
    bus.setMotor(true);
    bus.setMotor(true);
    expect(sink.loops.filter((name) => name === "motor")).toHaveLength(1);
    bus.setMotor(false);
    bus.setMotor(false);
    expect(sink.stopped).toEqual(["motor"]);
  });

  it("starts once the sounds arrive if it was asked for before", async () => {
    const sink = recordingSink();
    const bus = new AudioBus(() => sink);
    bus.setMotor(true);
    bus.unlock();
    bus.installAudio(producedCues(), bytes(4));
    await sink.settle();
    expect(sink.loops).toContain("motor");
  });
});

describe("mute", () => {
  it("starts unmuted and toggles", async () => {
    const { bus, sink } = await openBus();
    expect(bus.isMuted()).toBe(false);
    bus.toggleMute();
    expect(bus.isMuted()).toBe(true);
    expect(sink.muted).toBe(true);
    bus.toggleMute();
    expect(bus.isMuted()).toBe(false);
    expect(sink.muted).toBe(false);
  });

  it("silences the whole bus rather than stopping the game's sound", async () => {
    const { bus, sink } = await openBus();
    bus.setMotor(true);
    bus.toggleMute();
    // The loops the game is running are where it left them, silenced.
    expect(sink.loops).toContain("motor");
    expect(sink.loops).toContain(MUSIC_NAME);
    expect(sink.muted).toBe(true);
    bus.playCue("break");
    expect(bus.isMuted()).toBe(true);
    bus.toggleMute();
    expect(sink.muted).toBe(false);
    expect(sink.loops).toContain("motor");
  });

  it("is remembered across an unlock, from before the bus opened", () => {
    const sink = recordingSink();
    const bus = new AudioBus(() => sink);
    bus.toggleMute();
    expect(bus.isMuted()).toBe(true);
    bus.unlock();
    expect(sink.muted).toBe(true);
  });
});

// ---- The Web Audio half ---------------------------------------------------

/** A context that records the graph instead of making a sound. */
function fakeContext() {
  const gains: { value: number; connected: number }[] = [];
  const sources: {
    buffer: unknown;
    loop: boolean;
    started: number;
    stopped: number;
    onended: (() => void) | null;
    disconnected: number;
  }[] = [];
  let resumes = 0;
  const context = {
    destination: { name: "destination" },
    resume() {
      resumes += 1;
      return Promise.resolve();
    },
    createGain() {
      const gain = { value: 1, connected: 0 };
      gains.push(gain);
      return {
        gain,
        connect: () => {
          gain.connected += 1;
        },
        disconnect: () => {},
      };
    },
    createBufferSource() {
      const source = {
        buffer: null as unknown,
        loop: false,
        started: 0,
        stopped: 0,
        onended: null as (() => void) | null,
        disconnected: 0,
      };
      sources.push(source);
      return {
        get buffer() {
          return source.buffer;
        },
        set buffer(value: unknown) {
          source.buffer = value;
        },
        get loop() {
          return source.loop;
        },
        set loop(value: boolean) {
          source.loop = value;
        },
        set onended(handler: (() => void) | null) {
          source.onended = handler;
        },
        connect: () => {},
        disconnect: () => {
          source.disconnected += 1;
        },
        start: () => {
          source.started += 1;
        },
        stop: () => {
          source.stopped += 1;
        },
      };
    },
    decodeAudioData(data: ArrayBuffer) {
      return Promise.resolve({ byteLength: data.byteLength });
    },
  };
  return {
    context: context as unknown as AudioContext,
    gains,
    sources,
    resumes: () => resumes,
  };
}

describe("the Web Audio bus", () => {
  const loaded = async () => {
    const fake = fakeContext();
    const sink = audioSinkOver(fake.context);
    await sink.load(
      new Map([
        ["place", bytes(8)],
        [MUSIC_NAME, bytes(16)],
      ]),
    );
    return { fake, sink };
  };

  it("puts a master gain in front of the destination", () => {
    const fake = fakeContext();
    audioSinkOver(fake.context);
    expect(fake.gains).toHaveLength(1);
    expect(fake.gains[0]?.connected).toBe(1);
    expect(fake.resumes()).toBeGreaterThan(0);
  });

  it("decodes every sound it is handed", async () => {
    const { fake, sink } = await loaded();
    sink.play("place", 1);
    expect(fake.sources).toHaveLength(1);
    expect(fake.sources[0]?.buffer).toEqual({ byteLength: 8 });
    expect(fake.sources[0]?.started).toBe(1);
    expect(fake.sources[0]?.loop).toBe(false);
  });

  it("says nothing for a sound it never decoded", async () => {
    const { fake, sink } = await loaded();
    sink.play("nothing-like-it", 1);
    sink.startLoop("nothing-like-it", 1);
    expect(fake.sources).toHaveLength(0);
  });

  it("takes each voice down when it ends", async () => {
    const { fake, sink } = await loaded();
    sink.play("place", 0.5);
    fake.sources[0]?.onended?.();
    expect(fake.sources[0]?.disconnected).toBe(1);
  });

  it("plays a voice at the gain it is given", async () => {
    const { fake, sink } = await loaded();
    sink.play("place", 0.25);
    // The master gain is the first; the voice's own is the second.
    expect(fake.gains[1]?.value).toBe(0.25);
  });

  it("loops a sound once, however often it is asked", async () => {
    const { fake, sink } = await loaded();
    sink.startLoop(MUSIC_NAME, 0.3);
    sink.startLoop(MUSIC_NAME, 0.3);
    expect(fake.sources).toHaveLength(1);
    expect(fake.sources[0]?.loop).toBe(true);
    expect(fake.sources[0]?.started).toBe(1);
  });

  it("stops a loop, and takes a stop of one that is not running", async () => {
    const { fake, sink } = await loaded();
    sink.stopLoop(MUSIC_NAME);
    sink.startLoop(MUSIC_NAME, 0.3);
    sink.stopLoop(MUSIC_NAME);
    expect(fake.sources[0]?.stopped).toBe(1);
    // Stopped means gone: the next start is a fresh voice.
    sink.startLoop(MUSIC_NAME, 0.3);
    expect(fake.sources).toHaveLength(2);
  });

  it("silences the whole bus at the master gain", async () => {
    const { fake, sink } = await loaded();
    sink.setMuted(true);
    expect(fake.gains[0]?.value).toBe(0);
    sink.setMuted(false);
    expect(fake.gains[0]?.value).toBe(1);
  });

  it("is not there at all where the page has no Web Audio", () => {
    expect(typeof AudioContext).toBe("undefined");
    expect(webAudioSink()).toBeNull();
  });
});
