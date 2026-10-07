// The real mouse: a gesture the build's own input layer sees, one driven frame at
// a time.
//
// The point of driving Chromium's mouse rather than posing the pointer through
// the surface is that a build is free to act on a press from its own event
// handler, on the frame the event happens on. So each of the three parts runs
// exactly one frame, and what a check reads is what that frame did with it.

import { afterEach, beforeEach, expect, it } from "vitest";
import { mouseGlide, mousePress, mouseRelease } from "../src/index";
import { LANDMARK, createHarness, type Harness } from "./fixture";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("presses, glides and releases, one driven frame each", async () => {
  const before = await h.snapshot();
  expect(before.clicks).toBe(0);

  await mousePress(h, LANDMARK.x, LANDMARK.y);
  const pressed = await h.snapshot();
  expect(pressed.frames).toBe(1);
  expect(h.frame()).toBe(1);
  expect(pressed.clicks).toBe(1);
  // At the default shape the fit is the identity, so the CSS point the mouse was
  // moved to is the logical point the caller named.
  expect(pressed.pointer).toEqual({ x: LANDMARK.x, y: LANDMARK.y });

  await mouseGlide(h, 20, 30);
  const glided = await h.snapshot();
  expect(glided.frames).toBe(2);
  expect(glided.pointer).toEqual({ x: 20, y: 30 });
  // A glide is a move, not a second press.
  expect(glided.clicks).toBe(1);

  await mouseRelease(h);
  const released = await h.snapshot();
  expect(released.frames).toBe(3);
  expect(released.pointer).toEqual({ x: 20, y: 30 });
});

it("aims through the harness's own fit, not through raw CSS pixels", async () => {
  // A window twice the stage's size: the gesture still lands on the thing drawn
  // at the logical point, which is the whole reason the mapping is the harness's
  // rather than the caller's arithmetic.
  const wide = await createHarness({
    cssWidth: 400,
    cssHeight: 200,
  });
  try {
    await mousePress(wide, LANDMARK.x, LANDMARK.y);
    const at = wide.css(LANDMARK.x, LANDMARK.y);
    expect(at).toEqual({ x: LANDMARK.x * 2, y: LANDMARK.y * 2 });
    expect((await wide.snapshot()).pointer).toEqual(at);
  } finally {
    await wide.dispose();
  }
});
