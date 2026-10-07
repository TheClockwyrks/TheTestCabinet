// A media `play()` is a sound only when it starts one.
//
// The probe counts every way a page can emit audio, and an `<audio>` element's
// `play()` is one of them. But a build calls `play()` where nothing starts as
// well: on every keydown, to unlock audio under the autoplay policy, over a bed
// that is already looping — and per the HTML specification that call does
// nothing audible. The driven loop carries a sound made between two frames into
// the next frame it runs, so a probe that counted the no-op would stamp a cue
// onto the frame after every key the check pressed, and a point that requires
// silence there would fail a build that was silent. These pin the rule: a
// `play()` on an element that is paused, or that has played to its end, is a
// sound; a `play()` on one that is already playing is not.

import { afterEach, beforeEach, expect, it } from "vitest";
import { createHarness, type Harness } from "./fixture";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Put one `<audio>` element on the page, under a WAV the page makes itself, and
 * keep it under a name the calls below reach it by.
 *
 * Muted, because the autoplay policy always admits a muted play and the probe
 * reads whether the element is paused rather than whether it is heard; looping,
 * so it is still playing when the second `play()` lands.
 */
async function mountClip(h: Harness, loop: boolean): Promise<void> {
  await h.page.evaluate((loop) => {
    const rate = 8000;
    const seconds = 2;
    const bytes = new Uint8Array(44 + rate * seconds);
    const view = new DataView(bytes.buffer);
    const tag = (at: number, text: string) => {
      for (let i = 0; i < text.length; i += 1) {
        bytes[at + i] = text.charCodeAt(i);
      }
    };
    tag(0, "RIFF");
    view.setUint32(4, 36 + rate * seconds, true);
    tag(8, "WAVE");
    tag(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate, true);
    view.setUint16(32, 1, true);
    view.setUint16(34, 8, true);
    tag(36, "data");
    view.setUint32(40, rate * seconds, true);
    bytes.fill(128, 44);
    const clip = new Audio(
      URL.createObjectURL(new Blob([bytes], { type: "audio/wav" })),
    );
    clip.muted = true;
    clip.loop = loop;
    (window as unknown as { __clip: HTMLAudioElement }).__clip = clip;
  }, loop);
}

/** Call `play()` on the mounted clip and wait for the platform's answer. */
function play(h: Harness): Promise<void> {
  return h.page.evaluate(() =>
    (window as unknown as { __clip: HTMLAudioElement }).__clip.play(),
  );
}

/** What the mounted clip says about itself. */
function clipState(h: Harness): Promise<{ paused: boolean; ended: boolean }> {
  return h.page.evaluate(() => {
    const clip = (window as unknown as { __clip: HTMLAudioElement }).__clip;
    return { paused: clip.paused, ended: clip.ended };
  });
}

it("counts a play() that starts a paused element, and not one over a playing element", async () => {
  await mountClip(h, true);
  expect(await h.sounds()).toBe(0);

  await play(h);
  expect(await clipState(h)).toEqual({ paused: false, ended: false });
  expect(await h.sounds()).toBe(1);
  expect(await h.loopingSounds()).toBe(1);

  // The unlock call: the element is already playing, so nothing starts.
  await play(h);
  await play(h);
  expect(await h.sounds()).toBe(1);
  expect(await h.loopingSounds()).toBe(1);

  // Paused, so the next play() is a start again.
  await h.page.evaluate(() =>
    (window as unknown as { __clip: HTMLAudioElement }).__clip.pause(),
  );
  expect(await h.loopingSounds()).toBe(0);
  await play(h);
  expect(await h.sounds()).toBe(2);
  expect(await h.loopingSounds()).toBe(1);
});

it("counts a play() over an element that has played to its end", async () => {
  await mountClip(h, false);
  await play(h);
  expect(await h.sounds()).toBe(1);

  // Run out the clip. The specification has an element that reaches its end
  // set `paused` again and raise `ended`; either reading admits the next play.
  await h.page.evaluate(() => {
    const clip = (window as unknown as { __clip: HTMLAudioElement }).__clip;
    clip.currentTime = clip.duration - 0.05;
    return new Promise<void>((resolve) => {
      if (clip.ended) resolve();
      else clip.addEventListener("ended", () => resolve(), { once: true });
    });
  });
  const ended = await clipState(h);
  expect(ended.ended || ended.paused).toBe(true);
  expect(await h.sounds()).toBe(1);

  await play(h);
  expect(await h.sounds()).toBe(2);
});
