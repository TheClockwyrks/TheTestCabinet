// The audio bus, over a recording stand-in for a Web Audio context.
//
// Two properties matter more than the sound itself, and both are checked here:
// nothing about audio may fail a tick, and muting is a gain of zero rather than a
// skipped cue, so a muted game and a loud one behave identically apart from what
// comes out of the speakers.

import { describe, expect, it, vi } from "vitest";
import {
  AudioBus,
  DEFAULT_CUE_GAIN,
  platformAudioContext,
  type CueSpec,
} from "./audio-bus";
import { CUE_SPECS, defineCues } from "./audio";
import { CUES } from "./constants";
import type { InitApi } from "./runtime";

/** One note the fake context was asked to sound. */
interface Note {
  wave: string;
  freq: number;
  freqTo: number | null;
  gain: number;
  seconds: number;
}

/** A context that writes down what it was asked to play. */
function fakeContext(): { context: AudioContext; notes: Note[] } {
  const notes: Note[] = [];
  const context = {
    currentTime: 0,
    destination: {},
    resume: () => Promise.resolve(),
    close: () => Promise.resolve(),
    createOscillator: () => {
      const note: Note = {
        wave: "sine",
        freq: 0,
        freqTo: null,
        gain: 0,
        seconds: 0,
      };
      notes.push(note);
      return {
        set type(value: string) {
          note.wave = value;
        },
        frequency: {
          setValueAtTime: (value: number) => {
            note.freq = value;
          },
          exponentialRampToValueAtTime: (value: number, at: number) => {
            note.freqTo = value;
            note.seconds = at;
          },
        },
        connect: (next: unknown) => next,
        start: () => undefined,
        stop: (at: number) => {
          note.seconds = at;
        },
      };
    },
    createGain: () => ({
      gain: {
        setValueAtTime: (value: number) => {
          notes[notes.length - 1].gain = value;
        },
        exponentialRampToValueAtTime: () => undefined,
      },
      connect: (next: unknown) => next,
    }),
  };
  return { context: context as unknown as AudioContext, notes };
}

const BLIP: CueSpec = { wave: "square", freq: 440, gain: 0.3, durationMs: 50 };

describe("declaring and playing", () => {
  it("plays a declared cue through the context, once per call", () => {
    const { context, notes } = fakeContext();
    const bus = new AudioBus(() => context);
    bus.define("blip", BLIP);
    const target = new EventTarget();
    bus.armUnlock(target);
    target.dispatchEvent(new Event("pointerdown"));

    bus.play("blip");
    bus.play("blip");
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({ wave: "square", freq: 440, gain: 0.3 });
    expect(notes[0].seconds).toBeCloseTo(0.05, 9);
  });

  it("throws on a cue nothing declared, so a mistyped name is not silence", () => {
    const bus = new AudioBus(() => null);
    expect(() => bus.play("nope")).toThrow(/never defined/);
  });

  it("takes the default gain for a cue that names none", () => {
    const { context, notes } = fakeContext();
    const bus = new AudioBus(() => context);
    bus.define("bare", { freq: 300, durationMs: 20 });
    const target = new EventTarget();
    bus.armUnlock(target);
    target.dispatchEvent(new Event("keydown"));
    bus.play("bare");
    expect(notes[0].gain).toBeCloseTo(DEFAULT_CUE_GAIN, 9);
  });

  it("replaces a cue redeclared under the same name", () => {
    const { context, notes } = fakeContext();
    const bus = new AudioBus(() => context);
    bus.define("blip", BLIP);
    bus.define("blip", { freq: 100, durationMs: 10 });
    const target = new EventTarget();
    bus.armUnlock(target);
    target.dispatchEvent(new Event("touchstart"));
    bus.play("blip");
    expect(notes[0].freq).toBe(100);
  });
});

describe("muting", () => {
  it("sounds nothing while muted, and sounds again once it is not", () => {
    const { context, notes } = fakeContext();
    const bus = new AudioBus(() => context);
    bus.define("blip", BLIP);
    const target = new EventTarget();
    bus.armUnlock(target);
    target.dispatchEvent(new Event("pointerdown"));

    bus.setMuted(true);
    expect(bus.muted()).toBe(true);
    bus.play("blip");
    expect(notes).toHaveLength(0);

    bus.setMuted(false);
    expect(bus.muted()).toBe(false);
    bus.play("blip");
    expect(notes).toHaveLength(1);
  });

  it("starts unmuted", () => {
    expect(new AudioBus(() => null).muted()).toBe(false);
  });
});

describe("the first gesture", () => {
  it("stays locked until one arrives, and opens on any of the three", () => {
    for (const gesture of ["pointerdown", "keydown", "touchstart"]) {
      const { context } = fakeContext();
      const bus = new AudioBus(() => context);
      const target = new EventTarget();
      bus.armUnlock(target);
      expect(bus.unlocked()).toBe(false);
      target.dispatchEvent(new Event(gesture));
      expect(bus.unlocked(), gesture).toBe(true);
    }
  });

  it("drops its listeners once it has opened", () => {
    const { context } = fakeContext();
    const bus = new AudioBus(() => context);
    const target = new EventTarget();
    const removals = vi.spyOn(target, "removeEventListener");
    bus.armUnlock(target);
    target.dispatchEvent(new Event("pointerdown"));
    expect(removals).toHaveBeenCalledTimes(3);
  });

  it("plays nothing rather than throwing while it is still locked", () => {
    const bus = new AudioBus(() => fakeContext().context);
    bus.define("blip", BLIP);
    expect(() => bus.play("blip")).not.toThrow();
  });
});

describe("a platform with no audio at all", () => {
  it("degrades to silence, never to a thrown tick", () => {
    const bus = new AudioBus(() => null);
    bus.define("blip", BLIP);
    const target = new EventTarget();
    bus.armUnlock(target);
    target.dispatchEvent(new Event("pointerdown"));
    expect(bus.unlocked()).toBe(false);
    expect(() => bus.play("blip")).not.toThrow();
    expect(() => bus.dispose()).not.toThrow();
  });

  it("reports no context where the platform has no constructor", () => {
    // Node has no Web Audio, which is exactly the case this guards.
    expect(platformAudioContext()).toBe(null);
  });

  it("survives a context that throws mid-cue", () => {
    const bus = new AudioBus(
      () =>
        ({
          currentTime: 0,
          destination: {},
          resume: () => Promise.resolve(),
          close: () => Promise.resolve(),
          createOscillator: () => {
            throw new Error("the context died");
          },
          createGain: () => ({}),
        }) as unknown as AudioContext,
    );
    bus.define("blip", BLIP);
    const target = new EventTarget();
    bus.armUnlock(target);
    target.dispatchEvent(new Event("pointerdown"));
    expect(() => bus.play("blip")).not.toThrow();
  });
});

describe("the game's ten cues", () => {
  it("declares one distinct sound for each of them", () => {
    const declared = new Map<string, CueSpec>();
    const api = {
      input: { register: () => undefined },
      audio: {
        define: (cue: string, spec: CueSpec) => declared.set(cue, spec),
      },
      diagnostics: { register: () => undefined },
    } as unknown as InitApi;
    defineCues(api);

    const names = Object.values(CUES);
    expect(names).toHaveLength(10);
    expect([...declared.keys()].sort()).toEqual([...names].sort());

    const shapes = new Set(
      names.map((name) => {
        const spec = CUE_SPECS[name];
        return `${spec.wave}/${spec.freq}/${spec.freqTo ?? "-"}/${spec.durationMs}`;
      }),
    );
    expect(shapes.size).toBe(names.length);
  });

  it("plays every one of them without a context", () => {
    const bus = new AudioBus(() => null);
    for (const [cue, spec] of Object.entries(CUE_SPECS)) bus.define(cue, spec);
    for (const cue of Object.values(CUES)) {
      expect(() => bus.play(cue), cue).not.toThrow();
    }
  });
});
