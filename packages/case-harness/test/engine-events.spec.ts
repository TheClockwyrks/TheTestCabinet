// The events a check raises on the engine's own event target.
//
// The two pointer events are the reason this file exists. They are not two
// spellings of one gesture: a structured engine's input reads `button` and
// `buttons` and takes a different path when they are ABSENT, so a case's
// verdicts are decided under the one it dispatches. These checks pin each
// field set, so folding them back into one event fails here rather than moving
// a case's pointer verdicts silently.

import { expect, it } from "vitest";
import {
  DevicePointerEvent,
  KeyEvent,
  PointerPositionEvent,
  YIELD_AFTER_FRAMES,
  breathe,
  surfaceMetrics,
} from "../src/engine/events";

it("a key event carries the code and the repeat flag an engine reads", () => {
  const down = new KeyEvent("keydown", "KeyA");
  expect(down.type).toBe("keydown");
  expect(down.code).toBe("KeyA");
  expect(down.repeat).toBe(false);
  expect(new KeyEvent("keyup", "Space", true).repeat).toBe(true);
});

it("a key event reaches a listener on the target it is dispatched at", () => {
  const target = new EventTarget();
  const seen: string[] = [];
  target.addEventListener("keydown", (event) => {
    seen.push((event as KeyEvent).code);
  });
  target.dispatchEvent(new KeyEvent("keydown", "Backquote"));
  expect(seen).toEqual(["Backquote"]);
});

it("the position-only pointer event names NO button and NO device", () => {
  const event = new PointerPositionEvent("pointerdown", 12, 34);
  expect(event.clientX).toBe(12);
  expect(event.clientY).toBe(34);
  expect(event.isPrimary).toBe(true);
  // The whole point of this event: an engine that reads for these finds them
  // absent and applies its own default.
  expect((event as unknown as Record<string, unknown>).button).toBeUndefined();
  expect((event as unknown as Record<string, unknown>).buttons).toBeUndefined();
  expect(
    (event as unknown as Record<string, unknown>).pointerType,
  ).toBeUndefined();
});

it("the device pointer event reports a real button mask through a gesture", () => {
  const down = new DevicePointerEvent("pointerdown", 1, 2, "touch");
  expect(down.pointerType).toBe("touch");
  expect(down.pointerId).toBe(1);
  expect(down.button).toBe(0);
  expect(down.buttons).toBe(1);

  const move = new DevicePointerEvent("pointermove", 1, 2, "mouse");
  // A move names no button at all, which is what a browser sends.
  expect(move.button).toBe(-1);
  expect(move.buttons).toBe(1);

  const up = new DevicePointerEvent("pointerup", 1, 2, "mouse");
  expect(up.button).toBe(0);
  expect(up.buttons).toBe(0);
});

it("the surface metrics report one fixed shape and one target", () => {
  const target = new EventTarget();
  const metrics = surfaceMetrics(
    { cssWidth: 640, cssHeight: 360, dpr: 2 },
    target,
  );
  expect(metrics.cssWidth()).toBe(640);
  expect(metrics.cssHeight()).toBe(360);
  expect(metrics.dpr()).toBe(2);
  expect(metrics.events()).toBe(target);
  // There is no element behind this surface, so it owns no browser gestures and
  // routes no pointer capture. An engine that reads for them must find them
  // absent and do without.
  expect(metrics.origin).toBeUndefined();
  expect(metrics.claimGestures).toBeUndefined();
  expect(metrics.capturePointer).toBeUndefined();
  expect(metrics.releasePointerCapture).toBeUndefined();
});

it("a sweep that has not driven enough frames does not yield", async () => {
  const driven = YIELD_AFTER_FRAMES - 1;
  expect(await breathe(driven)).toBe(driven);
});

it("a sweep past the count yields and starts a new stretch", async () => {
  expect(await breathe(YIELD_AFTER_FRAMES)).toBe(0);
});

it("the yield really lets the loop turn", async () => {
  const order: string[] = [];
  setImmediate(() => order.push("loop"));
  await breathe(YIELD_AFTER_FRAMES);
  order.push("sweep");
  expect(order).toEqual(["loop", "sweep"]);
});
