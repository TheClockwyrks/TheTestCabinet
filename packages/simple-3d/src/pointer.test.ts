import { beforeEach, describe, expect, it } from "vitest";
import type { SurfaceMetrics } from "./viewport";
import type { Viewport } from "./math";
import { POINTER_SAMPLE_CAP, PointerInput } from "./pointer";

/**
 * This suite covers the pointer tracker alone: the client-to-logical mapping,
 * the snapshot, the edges, and the per-frame sample list. What a logical
 * position means inside the scene — the ray through it — is `pointerRay`'s
 * business over on the viewport module, so no camera appears here; the tracker
 * is exercised against hand-made {@link Viewport} values, the fit being an
 * input to this module rather than something it computes.
 *
 * A surface over a bare `EventTarget` is the fixture, like the input registry's
 * suite: the pointer's whole reason for taking its target from
 * {@link SurfaceMetrics} is that an engine driven by a validator has no
 * document to listen on.
 */
function surfaceOver(
  target: EventTarget,
  overrides: Partial<SurfaceMetrics> = {},
): SurfaceMetrics {
  return {
    cssWidth: () => 640,
    cssHeight: () => 360,
    dpr: () => 1,
    events: () => target,
    ...overrides,
  };
}

/** An identity fit: one device pixel per logical unit, no bars. */
function identityViewport(): Viewport {
  return { width: 640, height: 360, scale: 1, offsetX: 0, offsetY: 0 };
}

/**
 * Pointer-shaped plain events, the way a validator dispatches them: not
 * `PointerEvent`s from this realm — the node environment has none — but objects
 * carrying the fields the listeners read, which the tracker narrows
 * structurally.
 */
function pointer(
  target: EventTarget,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  x: number,
  y: number,
  isPrimary = true,
): void {
  target.dispatchEvent(
    Object.assign(new Event(type), { clientX: x, clientY: y, isPrimary }),
  );
}

describe("PointerInput", () => {
  let target: EventTarget;
  let viewport: Viewport;
  let input: PointerInput;

  beforeEach(() => {
    target = new EventTarget();
    viewport = identityViewport();
    input = new PointerInput(surfaceOver(target), () => viewport);
  });

  describe("the snapshot", () => {
    it("rests at (0, 0), up, before any event", () => {
      expect(input.snapshot()).toEqual({ x: 0, y: 0, down: false });
    });

    it("follows the most recent sample and the hold", () => {
      pointer(target, "pointerdown", 100, 50);
      pointer(target, "pointermove", 120, 60);

      expect(input.snapshot()).toEqual({ x: 120, y: 60, down: true });

      pointer(target, "pointerup", 130, 70);

      expect(input.snapshot()).toEqual({ x: 130, y: 70, down: false });
    });

    it("hands out a fresh copy each read", () => {
      const first = input.snapshot();
      first.x = 999;

      expect(input.snapshot().x).toBe(0);
    });
  });

  describe("the mapping", () => {
    it("maps a client position through the origin, the ratio, and the fit", () => {
      // A 1280x720 stage letterboxed into the canvas: dpr 2, a 20-device-pixel
      // top bar, half a device pixel per logical unit, and the canvas 10 CSS
      // pixels from the client origin on each axis.
      viewport = {
        width: 1280,
        height: 720,
        scale: 0.5,
        offsetX: 0,
        offsetY: 20,
      };
      input = new PointerInput(
        surfaceOver(target, { dpr: () => 2, origin: () => ({ x: 10, y: 10 }) }),
        () => viewport,
      );

      pointer(target, "pointerdown", 330, 200);

      // x: (330 - 10) * 2 / 0.5 = 1280; y: ((200 - 10) * 2 - 20) / 0.5 = 720.
      expect(input.snapshot()).toEqual({ x: 1280, y: 720, down: true });
    });

    it("reads the origin as (0, 0) when the surface supplies none", () => {
      pointer(target, "pointermove", 320, 180);

      expect(input.snapshot()).toEqual({ x: 320, y: 180, down: false });
    });

    it("maps a position inside a letterbox bar outside the logical field, and still reports it", () => {
      // A 10-device-pixel left bar: a client x of 4 sits inside the bar, so it
      // maps below zero — the game clamps it or treats it as a miss, per the docs.
      viewport = { width: 640, height: 360, scale: 1, offsetX: 10, offsetY: 0 };

      pointer(target, "pointermove", 4, 100);

      expect(input.snapshot()).toEqual({ x: -6, y: 100, down: false });
    });

    it("reads the fit live rather than the one at construction", () => {
      pointer(target, "pointermove", 100, 100);
      viewport = { width: 640, height: 360, scale: 2, offsetX: 0, offsetY: 0 };
      pointer(target, "pointermove", 100, 100);

      expect(input.snapshot()).toEqual({ x: 50, y: 50, down: false });
    });
  });

  describe("edges", () => {
    it("arms the press once per press, consumed on read", () => {
      pointer(target, "pointerdown", 5, 5);

      expect(input.pressed()).toBe(true);
      expect(input.pressed()).toBe(false);
    });

    it("arms the release once per release, consumed on read", () => {
      pointer(target, "pointerdown", 5, 5);
      pointer(target, "pointerup", 6, 6);

      expect(input.released()).toBe(true);
      expect(input.released()).toBe(false);
    });

    it("treats a second down during a hold as a move, not a new press", () => {
      pointer(target, "pointerdown", 5, 5);
      expect(input.pressed()).toBe(true);

      pointer(target, "pointerdown", 9, 9);

      expect(input.pressed()).toBe(false);
      expect(input.snapshot()).toEqual({ x: 9, y: 9, down: true });
    });

    it("treats an up with no hold as a move, not a release", () => {
      pointer(target, "pointerup", 7, 7);

      expect(input.released()).toBe(false);
      expect(input.snapshot()).toEqual({ x: 7, y: 7, down: false });
    });

    it("discards unconsumed edges when the frame closes", () => {
      pointer(target, "pointerdown", 5, 5);
      pointer(target, "pointerup", 6, 6);

      input.endFrame();

      expect(input.pressed()).toBe(false);
      expect(input.released()).toBe(false);
    });
  });

  describe("the sample list", () => {
    it("lists the frame's samples in arrival order", () => {
      pointer(target, "pointerdown", 1, 1);
      pointer(target, "pointermove", 2, 2);
      pointer(target, "pointermove", 3, 3);
      pointer(target, "pointerup", 4, 4);

      expect(input.samples()).toEqual([
        { type: "down", x: 1, y: 1 },
        { type: "move", x: 2, y: 2 },
        { type: "move", x: 3, y: 3 },
        { type: "up", x: 4, y: 4 },
      ]);
    });

    it("does not consume on read, and empties when the frame closes", () => {
      pointer(target, "pointermove", 2, 2);

      expect(input.samples()).toHaveLength(1);
      expect(input.samples()).toHaveLength(1);

      input.endFrame();

      expect(input.samples()).toEqual([]);
    });

    it("hands out a fresh copy each read", () => {
      pointer(target, "pointermove", 2, 2);
      const first = input.samples();
      first.pop();

      expect(input.samples()).toHaveLength(1);
    });

    it("stops listing past the cap while the snapshot keeps moving", () => {
      for (let i = 0; i < POINTER_SAMPLE_CAP + 5; i++) {
        pointer(target, "pointermove", i, i);
      }

      expect(input.samples()).toHaveLength(POINTER_SAMPLE_CAP);
      expect(input.snapshot().x).toBe(POINTER_SAMPLE_CAP + 4);
    });
  });

  describe("refused events", () => {
    it("ignores a non-primary pointer entirely", () => {
      pointer(target, "pointerdown", 5, 5);
      pointer(target, "pointermove", 9, 9, false);
      pointer(target, "pointerup", 9, 9, false);

      expect(input.snapshot()).toEqual({ x: 5, y: 5, down: true });
      expect(input.released()).toBe(false);
    });

    it("ignores an event with no client position", () => {
      target.dispatchEvent(new Event("pointerdown"));

      expect(input.snapshot()).toEqual({ x: 0, y: 0, down: false });
      expect(input.pressed()).toBe(false);
    });

    it("drops a down and a move while the fit is degenerate", () => {
      viewport = { width: 640, height: 360, scale: 0, offsetX: 0, offsetY: 0 };
      pointer(target, "pointerdown", 5, 5);
      pointer(target, "pointermove", 9, 9);

      expect(input.snapshot()).toEqual({ x: 0, y: 0, down: false });
      expect(input.samples()).toEqual([]);
    });

    it("still ends a hold on an up the degenerate fit cannot place", () => {
      pointer(target, "pointerdown", 5, 5);
      viewport = { width: 640, height: 360, scale: 0, offsetX: 0, offsetY: 0 };

      pointer(target, "pointerup", 9, 9);

      expect(input.snapshot()).toEqual({ x: 5, y: 5, down: false });
      expect(input.released()).toBe(true);
      expect(input.samples()).toEqual([
        { type: "down", x: 5, y: 5 },
        { type: "up", x: 5, y: 5 },
      ]);
    });
  });

  describe("cancel", () => {
    it("ends a hold as a release at the last known position", () => {
      pointer(target, "pointerdown", 5, 5);
      pointer(target, "pointermove", 8, 8);

      target.dispatchEvent(new Event("pointercancel"));

      expect(input.snapshot()).toEqual({ x: 8, y: 8, down: false });
      expect(input.released()).toBe(true);
      expect(input.samples().at(-1)).toEqual({ type: "up", x: 8, y: 8 });
    });

    it("does nothing with no hold to end", () => {
      target.dispatchEvent(new Event("pointercancel"));

      expect(input.released()).toBe(false);
      expect(input.samples()).toEqual([]);
    });

    it("ignores a non-primary cancel", () => {
      pointer(target, "pointerdown", 5, 5);
      pointer(target, "pointercancel", 5, 5, false);

      expect(input.snapshot().down).toBe(true);
    });
  });

  describe("detach", () => {
    it("stops listening, and is idempotent", () => {
      input.detach();
      input.detach();

      pointer(target, "pointerdown", 5, 5);

      expect(input.snapshot()).toEqual({ x: 0, y: 0, down: false });
    });
  });
});
