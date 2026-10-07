// Wireworm — the audio bus (specs/ui.md).
//
// Three properties the rest of the build leans on: a cue is played by NAME, a
// MUTED bus emits nothing at all, and nothing about audio can fail a frame.

import { describe, expect, test, vi } from "vitest";
import { AudioBus, platformAudioContext } from "./audio-bus";
import { recordingAudio } from "./harness.test-support";

function bus(): { bus: AudioBus; probe: ReturnType<typeof recordingAudio> } {
  const probe = recordingAudio();
  return { bus: new AudioBus(probe.source), probe };
}

describe("the audio bus", () => {
  test("a declared cue sounds once it has been unlocked", () => {
    const { bus: audio, probe } = bus();
    const target = new EventTarget();
    audio.define("fire", { freq: 440, durationMs: 60 });
    audio.play("fire");
    // Nothing until a gesture opens the context.
    expect(probe.started()).toBe(0);
    audio.armUnlock(target);
    target.dispatchEvent(new Event("pointerdown"));
    expect(audio.unlocked()).toBe(true);
    audio.play("fire");
    expect(probe.started()).toBe(1);
  });

  test("a cue that was never declared throws at the event", () => {
    const { bus: audio } = bus();
    expect(() => audio.play("nothing")).toThrow(/never defined/);
  });

  test("a muted bus emits nothing at all", () => {
    const { bus: audio, probe } = bus();
    const target = new EventTarget();
    audio.armUnlock(target);
    target.dispatchEvent(new Event("keydown"));
    audio.define("cut", { freq: 300, durationMs: 60 });
    audio.setMuted(true);
    expect(audio.muted()).toBe(true);
    for (let i = 0; i < 5; i += 1) audio.play("cut");
    expect(probe.started()).toBe(0);
    audio.setMuted(false);
    audio.play("cut");
    expect(probe.started()).toBe(1);
  });

  test("a cue of no gain is silent", () => {
    const { bus: audio, probe } = bus();
    const target = new EventTarget();
    audio.armUnlock(target);
    target.dispatchEvent(new Event("keydown"));
    audio.define("quiet", { freq: 300, gain: 0, durationMs: 60 });
    audio.play("quiet");
    expect(probe.started()).toBe(0);
  });

  test("a platform with no audio degrades to silence", () => {
    const audio = new AudioBus(() => null);
    const target = new EventTarget();
    audio.armUnlock(target);
    target.dispatchEvent(new Event("keydown"));
    audio.define("fire", { freq: 440, durationMs: 60 });
    expect(() => audio.play("fire")).not.toThrow();
    expect(audio.unlocked()).toBe(false);
    audio.dispose();
  });

  test("a context that throws mid-cue does not fail the frame", () => {
    const audio = new AudioBus(
      () =>
        ({
          currentTime: 0,
          destination: {},
          createOscillator: () => {
            throw new Error("gone");
          },
          createGain: () => ({}),
          resume: () => Promise.resolve(),
          close: () => Promise.resolve(),
        }) as unknown as AudioContext,
    );
    const target = new EventTarget();
    audio.armUnlock(target);
    target.dispatchEvent(new Event("keydown"));
    audio.define("fire", { freq: 440, durationMs: 60 });
    expect(() => audio.play("fire")).not.toThrow();
  });

  test("a sweep and a hold are both accepted", () => {
    const { bus: audio, probe } = bus();
    const target = new EventTarget();
    audio.armUnlock(target);
    target.dispatchEvent(new Event("touchstart"));
    audio.define("sweep", { freq: 200, freqTo: 900, durationMs: 100 });
    audio.define("hold", { wave: "square", freq: 200, durationMs: 100 });
    audio.play("sweep");
    audio.play("hold");
    expect(probe.started()).toBe(2);
  });

  test("disposing drops the listeners and is idempotent", () => {
    const { bus: audio, probe } = bus();
    const target = new EventTarget();
    audio.armUnlock(target);
    audio.dispose();
    audio.dispose();
    target.dispatchEvent(new Event("keydown"));
    audio.define("fire", { freq: 440, durationMs: 60 });
    audio.play("fire");
    expect(probe.started()).toBe(0);
  });

  test("a platform with no AudioContext yields none", () => {
    const original = globalThis.AudioContext;
    // @ts-expect-error — removing the constructor is the whole of the scenario.
    delete globalThis.AudioContext;
    expect(platformAudioContext()).toBeNull();
    const failing = vi.fn(() => {
      throw new Error("blocked");
    });
    globalThis.AudioContext = failing as unknown as typeof AudioContext;
    expect(platformAudioContext()).toBeNull();
    if (original === undefined) {
      // @ts-expect-error — restoring the absence it started from.
      delete globalThis.AudioContext;
    } else {
      globalThis.AudioContext = original;
    }
  });
});
