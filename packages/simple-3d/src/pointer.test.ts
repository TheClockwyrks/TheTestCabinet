import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PointerSnapshot, SurfaceMetrics, Viewport } from "./contract";
import { POINTER_SAMPLE_CAP, PointerInput } from "./pointer";
import { createSurface } from "./testing/canvas";

/**
 * A surface over a bare `EventTarget`, like the input registry's suite: the
 * pointer's whole reason for taking its target from {@link SurfaceMetrics} is
 * that an engine driven by a validator has no document to listen on.
 *
 * This is the minimal surface — the four required members and nothing else —
 * which is what the "supplies none of the optional hooks" cases need. The suite's
 * gesture cases use `createSurface` from the harness instead, since that one
 * records what the engine asked of the optional half.
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

/** The fields a dispatched pointer event may carry beyond its position. */
interface PointerFields {
  isPrimary?: boolean;
  pointerId?: number;
  pointerType?: string;
  button?: number;
  buttons?: number;
}

/**
 * Pointer-shaped plain events, the way a validator dispatches them: not
 * `PointerEvent`s from this realm, but objects carrying the fields the listeners
 * read.
 */
function pointer(
  target: EventTarget,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  x: number,
  y: number,
  fields: PointerFields = {},
): void {
  target.dispatchEvent(
    Object.assign(new Event(type), { clientX: x, clientY: y, ...fields }),
  );
}

/** A wheel-shaped plain event. */
function wheel(
  target: EventTarget,
  deltaX: number,
  deltaY: number,
  deltaMode = 0,
): void {
  target.dispatchEvent(
    Object.assign(new Event("wheel"), { deltaX, deltaY, deltaMode }),
  );
}

/** The snapshot a mouse that has never moved reports. */
function resting(): PointerSnapshot {
  return { x: 0, y: 0, down: false, device: "mouse", buttons: [] };
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
      expect(input.snapshot()).toEqual(resting());
    });

    it("follows the most recent sample and the hold", () => {
      pointer(target, "pointerdown", 100, 50);
      pointer(target, "pointermove", 120, 60);

      expect(input.snapshot()).toEqual({
        x: 120,
        y: 60,
        down: true,
        device: "mouse",
        buttons: ["primary"],
      });

      pointer(target, "pointerup", 130, 70);

      expect(input.snapshot()).toEqual({
        x: 130,
        y: 70,
        down: false,
        device: "mouse",
        buttons: [],
      });
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
      viewport = { width: 1280, height: 720, scale: 0.5, offsetX: 0, offsetY: 20 };
      input = new PointerInput(
        surfaceOver(target, { dpr: () => 2, origin: () => ({ x: 10, y: 10 }) }),
        () => viewport,
      );

      pointer(target, "pointerdown", 330, 200);

      // x: (330 - 10) * 2 / 0.5 = 1280; y: ((200 - 10) * 2 - 20) / 0.5 = 720.
      expect(input.snapshot()).toMatchObject({ x: 1280, y: 720, down: true });
    });

    it("reads the origin as (0, 0) when the surface supplies none", () => {
      pointer(target, "pointermove", 320, 180);

      expect(input.snapshot()).toMatchObject({ x: 320, y: 180, down: false });
    });

    it("reads the fit live rather than the one at construction", () => {
      pointer(target, "pointermove", 100, 100);
      viewport = { width: 640, height: 360, scale: 2, offsetX: 0, offsetY: 0 };
      pointer(target, "pointermove", 100, 100);

      expect(input.snapshot()).toMatchObject({ x: 50, y: 50 });
    });

    it("reads a nonsensical device pixel ratio as 1", () => {
      input = new PointerInput(surfaceOver(target, { dpr: () => 0 }), () => viewport);

      pointer(target, "pointermove", 40, 20);

      expect(input.snapshot()).toMatchObject({ x: 40, y: 20 });
    });

    it("lands on the logical field the picture fills, bars and all", () => {
      // Pillarboxed: a 640x360 stage inside a wider canvas, with 100-device-pixel
      // bars on the left and right. A click in the left bar is off the picture,
      // and the position says so with a negative x rather than being clamped —
      // a ray through it would be a ray outside the picture, which the game
      // decides about.
      viewport = { width: 640, height: 360, scale: 1, offsetX: 100, offsetY: 0 };

      pointer(target, "pointermove", 40, 180);
      expect(input.snapshot()).toMatchObject({ x: -60, y: 180 });

      pointer(target, "pointermove", 100, 180);
      expect(input.snapshot()).toMatchObject({ x: 0, y: 180 });

      pointer(target, "pointermove", 740, 180);
      expect(input.snapshot()).toMatchObject({ x: 640, y: 180 });
    });

    it("maps the samples and the contacts onto the same field as the snapshot", () => {
      // What the view is handed must be one position, whichever read produced
      // it: a HUD hit test off the snapshot and a pick off a sample must agree.
      viewport = { width: 640, height: 360, scale: 0.5, offsetX: 20, offsetY: 10 };
      input = new PointerInput(surfaceOver(target, { dpr: () => 2 }), () => viewport);

      pointer(target, "pointerdown", 60, 55);

      // x: (60 * 2 - 20) / 0.5 = 200; y: (55 * 2 - 10) / 0.5 = 200.
      expect(input.snapshot()).toMatchObject({ x: 200, y: 200 });
      expect(input.samples()[0]).toMatchObject({ x: 200, y: 200 });
      expect(input.contacts()[0]).toMatchObject({ x: 200, y: 200 });
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

    it("defaults both edges to the primary button", () => {
      pointer(target, "pointerdown", 5, 5, { button: 0, buttons: 1 });
      expect(input.pressed("primary")).toBe(true);

      pointer(target, "pointerup", 5, 5, { button: 0, buttons: 0 });
      expect(input.released("primary")).toBe(true);
    });

    it("treats a second down of a held button as a move, not a new press", () => {
      pointer(target, "pointerdown", 5, 5);
      expect(input.pressed()).toBe(true);

      pointer(target, "pointerdown", 9, 9);

      expect(input.pressed()).toBe(false);
      expect(input.snapshot()).toMatchObject({ x: 9, y: 9, down: true });
    });

    it("treats an up with no hold as a move, not a release", () => {
      pointer(target, "pointerup", 7, 7);

      expect(input.released()).toBe(false);
      expect(input.snapshot()).toMatchObject({ x: 7, y: 7, down: false });
    });

    it("reports no edge for a button that never moved", () => {
      pointer(target, "pointerdown", 5, 5);

      expect(input.pressed("forward")).toBe(false);
      expect(input.released("back")).toBe(false);
    });

    it("discards unconsumed edges when the frame closes", () => {
      pointer(target, "pointerdown", 5, 5);
      pointer(target, "pointerup", 6, 6);

      input.endFrame();

      expect(input.pressed()).toBe(false);
      expect(input.released()).toBe(false);
    });
  });

  describe("buttons", () => {
    it("arms the secondary button's own edges", () => {
      pointer(target, "pointerdown", 5, 5, { button: 2, buttons: 2 });

      expect(input.pressed("secondary")).toBe(true);
      expect(input.pressed()).toBe(false);
      expect(input.snapshot()).toMatchObject({
        down: true,
        buttons: ["secondary"],
      });

      pointer(target, "pointerup", 5, 5, { button: 2, buttons: 0 });

      expect(input.released("secondary")).toBe(true);
      expect(input.released()).toBe(false);
    });

    it("keeps the contact while one of two held buttons is released", () => {
      pointer(target, "pointerdown", 5, 5, { button: 0, buttons: 1 });
      pointer(target, "pointerdown", 5, 5, { button: 2, buttons: 3 });

      expect(input.pressed("secondary")).toBe(true);
      expect(input.snapshot().buttons).toEqual(["primary", "secondary"]);

      pointer(target, "pointerup", 5, 5, { button: 2, buttons: 1 });

      expect(input.released("secondary")).toBe(true);
      expect(input.released()).toBe(false);
      expect(input.snapshot()).toMatchObject({
        down: true,
        buttons: ["primary"],
      });
      // One contact, so `down` and `up` stay one contact apart.
      expect(input.samples().map((s) => s.type)).toEqual(["down", "move", "move"]);
    });

    it("names the button on the sample that changed it", () => {
      pointer(target, "pointerdown", 5, 5, { button: 0, buttons: 1 });
      pointer(target, "pointermove", 6, 6, { button: -1, buttons: 1 });
      pointer(target, "pointerup", 6, 6, { button: 0, buttons: 0 });

      expect(input.samples().map((s) => s.button)).toEqual([
        "primary",
        null,
        "primary",
      ]);
    });

    it("maps the auxiliary button off its own index", () => {
      pointer(target, "pointerdown", 5, 5, { button: 1, buttons: 4 });

      expect(input.pressed("auxiliary")).toBe(true);
      expect(input.snapshot().buttons).toEqual(["auxiliary"]);
    });

    it("lists held buttons in the order PointerButton declares them", () => {
      // The mask names them all at once, and the order is the type's, not the
      // bits' arrival.
      pointer(target, "pointerdown", 5, 5, { button: 4, buttons: 31 });

      expect(input.snapshot().buttons).toEqual([
        "primary",
        "secondary",
        "auxiliary",
        "back",
        "forward",
      ]);
    });

    it("adds a chorded button in the declared order when no mask says so", () => {
      pointer(target, "pointerdown", 5, 5, { button: 0 });
      pointer(target, "pointerdown", 5, 5, { button: 2 });

      expect(input.snapshot().buttons).toEqual(["primary", "secondary"]);
      expect(input.pressed("secondary")).toBe(true);
    });

    it("ends the contact when a release names no button and carries no mask", () => {
      pointer(target, "pointerdown", 5, 5);
      pointer(target, "pointerup", 5, 5, { button: -1 });

      expect(input.released()).toBe(true);
      expect(input.contacts()).toEqual([]);
    });
  });

  describe("devices", () => {
    it("reports the device that drove the pointer", () => {
      pointer(target, "pointerdown", 5, 5, { pointerType: "touch" });

      expect(input.snapshot().device).toBe("touch");
      expect(input.samples()[0]?.device).toBe("touch");
    });

    it("reads an unrecognized pointer type as a mouse", () => {
      pointer(target, "pointerdown", 5, 5, { pointerType: "trackball" });

      expect(input.snapshot().device).toBe("mouse");
    });

    it("holds the primary button for a touch in contact", () => {
      pointer(target, "pointerdown", 5, 5, {
        pointerType: "touch",
        button: 0,
        buttons: 1,
      });

      expect(input.pressed()).toBe(true);
      expect(input.snapshot()).toMatchObject({
        down: true,
        buttons: ["primary"],
      });
    });

    it("plays a pen the same as a mouse on the primary reads", () => {
      pointer(target, "pointerdown", 5, 5, {
        pointerType: "pen",
        button: 0,
        buttons: 1,
      });

      expect(input.pressed()).toBe(true);
      expect(input.snapshot()).toMatchObject({
        device: "pen",
        down: true,
        buttons: ["primary"],
      });
    });
  });

  describe("contacts", () => {
    it("lists every pointer in contact, in contact order", () => {
      pointer(target, "pointerdown", 5, 5, { pointerId: 1, pointerType: "touch" });
      pointer(target, "pointerdown", 9, 9, {
        pointerId: 2,
        pointerType: "touch",
        isPrimary: false,
      });

      expect(input.contacts()).toEqual([
        {
          id: 1,
          x: 5,
          y: 5,
          primary: true,
          device: "touch",
          buttons: ["primary"],
        },
        {
          id: 2,
          x: 9,
          y: 9,
          primary: false,
          device: "touch",
          buttons: ["primary"],
        },
      ]);
    });

    it("moves a second contact without disturbing the first", () => {
      // What a pinch or a two-finger orbit reads: two positions on the field,
      // each tracked on its own.
      pointer(target, "pointerdown", 10, 10, { pointerId: 1, pointerType: "touch" });
      pointer(target, "pointerdown", 90, 90, {
        pointerId: 2,
        pointerType: "touch",
        isPrimary: false,
      });
      pointer(target, "pointermove", 120, 80, {
        pointerId: 2,
        pointerType: "touch",
        isPrimary: false,
      });

      expect(input.contacts().map((c) => ({ id: c.id, x: c.x, y: c.y }))).toEqual([
        { id: 1, x: 10, y: 10 },
        { id: 2, x: 120, y: 80 },
      ]);
    });

    it("leaves the snapshot and the edges to the primary pointer", () => {
      pointer(target, "pointerdown", 5, 5, { pointerId: 1 });
      expect(input.pressed()).toBe(true);

      pointer(target, "pointerdown", 9, 9, { pointerId: 2, isPrimary: false });
      pointer(target, "pointerup", 9, 9, { pointerId: 2, isPrimary: false });

      expect(input.pressed()).toBe(false);
      expect(input.released()).toBe(false);
      expect(input.snapshot()).toMatchObject({ x: 5, y: 5, down: true });
    });

    it("tracks an id-less non-primary pointer apart from the primary one", () => {
      pointer(target, "pointerdown", 5, 5);
      pointer(target, "pointerdown", 9, 9, { isPrimary: false });

      expect(input.contacts().map((c) => c.id)).toEqual([0, 1]);
    });

    it("drops a contact when it is released, and survives the frame closing", () => {
      pointer(target, "pointerdown", 5, 5, { pointerId: 1 });

      input.endFrame();
      expect(input.contacts()).toHaveLength(1);

      pointer(target, "pointerup", 5, 5, { pointerId: 1 });

      expect(input.contacts()).toEqual([]);
    });

    it("hands out a fresh copy each read", () => {
      pointer(target, "pointerdown", 5, 5);
      const first = input.contacts();
      first.pop();

      expect(input.contacts()).toHaveLength(1);
    });
  });

  describe("the sample list", () => {
    it("lists the frame's samples in arrival order", () => {
      pointer(target, "pointerdown", 1, 1);
      pointer(target, "pointermove", 2, 2);
      pointer(target, "pointermove", 3, 3);
      pointer(target, "pointerup", 4, 4);

      expect(
        input.samples().map((sample) => ({
          type: sample.type,
          x: sample.x,
          y: sample.y,
        })),
      ).toEqual([
        { type: "down", x: 1, y: 1 },
        { type: "move", x: 2, y: 2 },
        { type: "move", x: 3, y: 3 },
        { type: "up", x: 4, y: 4 },
      ]);
    });

    it("lists a hovering pointer's moves with no buttons", () => {
      pointer(target, "pointermove", 2, 2);

      expect(input.samples()[0]).toMatchObject({
        type: "move",
        buttons: [],
      });
    });

    it("carries the pointer that produced each sample", () => {
      pointer(target, "pointerdown", 1, 1, { pointerId: 7, pointerType: "touch" });

      expect(input.samples()[0]).toMatchObject({
        id: 7,
        primary: true,
        device: "touch",
        buttons: ["primary"],
      });
    });

    it("interleaves two pointers' samples in arrival order", () => {
      pointer(target, "pointerdown", 1, 1, { pointerId: 1 });
      pointer(target, "pointerdown", 2, 2, { pointerId: 2, isPrimary: false });
      pointer(target, "pointermove", 3, 3, { pointerId: 1 });
      pointer(target, "pointermove", 4, 4, { pointerId: 2, isPrimary: false });

      expect(input.samples().map((sample) => [sample.id, sample.type])).toEqual([
        [1, "down"],
        [2, "down"],
        [1, "move"],
        [2, "move"],
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

    it("keeps the contacts and the edges past the cap, and lists again next frame", () => {
      for (let i = 0; i < POINTER_SAMPLE_CAP; i++) pointer(target, "pointermove", i, i);
      pointer(target, "pointerdown", 500, 500, { pointerId: 3 });

      expect(input.samples()).toHaveLength(POINTER_SAMPLE_CAP);
      expect(input.pressed()).toBe(true);
      expect(input.contacts()).toHaveLength(1);

      input.endFrame();
      pointer(target, "pointermove", 501, 501, { pointerId: 3 });

      expect(input.samples()).toHaveLength(1);
    });
  });

  describe("the wheel", () => {
    it("accumulates travel over the frame, in logical units", () => {
      wheel(target, 10, -20);
      wheel(target, 5, 0);

      expect(input.wheel()).toEqual({ x: 15, y: -20 });
    });

    it("maps travel through the ratio and the fit", () => {
      viewport = { width: 1280, height: 720, scale: 0.5, offsetX: 0, offsetY: 0 };
      input = new PointerInput(surfaceOver(target, { dpr: () => 2 }), () => viewport);

      wheel(target, 0, 10);

      expect(input.wheel()).toEqual({ x: 0, y: 40 });
    });

    it("converts a wheel reporting lines and one reporting pages", () => {
      wheel(target, 0, 2, 1);
      expect(input.wheel().y).toBe(32);

      input.endFrame();

      wheel(target, 0, 1, 2);
      expect(input.wheel().y).toBe(360);
    });

    it("falls back to a line's worth for a page over a surface with no height", () => {
      input = new PointerInput(surfaceOver(target, { cssHeight: () => 0 }), () => viewport);

      wheel(target, 0, 1, 2);

      expect(input.wheel().y).toBe(16);
    });

    it("returns to zero when the frame closes", () => {
      wheel(target, 1, 1);
      input.endFrame();

      expect(input.wheel()).toEqual({ x: 0, y: 0 });
    });

    it("hands out a fresh copy each read", () => {
      wheel(target, 3, 4);

      expect(input.wheel()).not.toBe(input.wheel());
      expect(input.wheel()).toEqual({ x: 3, y: 4 });
    });

    it("ignores an event with no numeric delta, and one the fit cannot scale", () => {
      target.dispatchEvent(new Event("wheel"));
      viewport = { width: 640, height: 360, scale: 0, offsetX: 0, offsetY: 0 };
      wheel(target, 5, 5);

      expect(input.wheel()).toEqual({ x: 0, y: 0 });
    });
  });

  describe("gesture ownership", () => {
    it("claims the surface's gestures on attach and gives them back on detach", () => {
      const stub = createSurface({ cssWidth: 640, cssHeight: 360, dpr: 1 });
      const attached = new PointerInput(stub.surface, () => viewport);

      expect(stub.claims()).toBe(1);
      expect(stub.releases()).toBe(0);

      attached.detach();
      attached.detach();

      expect(stub.releases()).toBe(1);
    });

    it("captures a pointer as it comes into contact and releases it as it leaves", () => {
      const stub = createSurface({ cssWidth: 640, cssHeight: 360, dpr: 1 });
      const attached = new PointerInput(stub.surface, () => viewport);

      pointer(stub.target, "pointerdown", 5, 5, { pointerId: 3 });
      expect(stub.captured()).toEqual([3]);
      expect(stub.releasedCaptures()).toEqual([]);

      pointer(stub.target, "pointerup", 5, 5, { pointerId: 3 });
      expect(stub.releasedCaptures()).toEqual([3]);

      attached.detach();
    });

    it("keeps the capture while a chorded button is released", () => {
      const stub = createSurface({ cssWidth: 640, cssHeight: 360, dpr: 1 });
      const attached = new PointerInput(stub.surface, () => viewport);

      pointer(stub.target, "pointerdown", 5, 5, { pointerId: 2, button: 0, buttons: 1 });
      pointer(stub.target, "pointerdown", 5, 5, { pointerId: 2, button: 2, buttons: 3 });
      pointer(stub.target, "pointerup", 5, 5, { pointerId: 2, button: 2, buttons: 1 });

      expect(stub.captured()).toEqual([2]);
      expect(stub.releasedCaptures()).toEqual([]);

      attached.detach();
    });

    it("releases a still-held capture when it detaches", () => {
      const stub = createSurface({ cssWidth: 640, cssHeight: 360, dpr: 1 });
      const attached = new PointerInput(stub.surface, () => viewport);

      pointer(stub.target, "pointerdown", 5, 5, { pointerId: 4 });
      pointer(stub.target, "pointerdown", 6, 6, {
        pointerId: 5,
        isPrimary: false,
      });
      attached.detach();

      expect(stub.releasedCaptures()).toEqual([4, 5]);
      expect(attached.contacts()).toEqual([]);
    });

    it("releases the capture on the cancel that ended the contact", () => {
      const stub = createSurface({ cssWidth: 640, cssHeight: 360, dpr: 1 });
      const attached = new PointerInput(stub.surface, () => viewport);

      pointer(stub.target, "pointerdown", 5, 5, { pointerId: 6 });
      stub.target.dispatchEvent(
        Object.assign(new Event("pointercancel"), { pointerId: 6 }),
      );

      expect(stub.releasedCaptures()).toEqual([6]);

      attached.detach();
    });

    it("works over a surface supplying none of the three", () => {
      pointer(target, "pointerdown", 5, 5);

      expect(input.pressed()).toBe(true);

      input.detach();

      expect(input.contacts()).toEqual([]);
    });

    it("gives the gestures back exactly once even when the claim is shared", () => {
      const give = vi.fn();
      const claimGestures = vi.fn(() => give);
      const attached = new PointerInput(
        surfaceOver(target, { claimGestures }),
        () => viewport,
      );

      expect(claimGestures).toHaveBeenCalledTimes(1);
      expect(give).not.toHaveBeenCalled();

      attached.detach();
      attached.detach();

      expect(give).toHaveBeenCalledTimes(1);
    });
  });

  describe("refused events", () => {
    it("ignores an event with no client position", () => {
      target.dispatchEvent(new Event("pointerdown"));

      expect(input.snapshot()).toEqual(resting());
      expect(input.pressed()).toBe(false);
    });

    it("ignores a move and an up with no client position", () => {
      pointer(target, "pointerdown", 5, 5);
      target.dispatchEvent(new Event("pointermove"));
      target.dispatchEvent(new Event("pointerup"));

      expect(input.snapshot()).toMatchObject({ x: 5, y: 5, down: true });
      expect(input.released()).toBe(false);
    });

    it("drops a down and a move while the fit is degenerate", () => {
      viewport = { width: 640, height: 360, scale: 0, offsetX: 0, offsetY: 0 };
      pointer(target, "pointerdown", 5, 5);
      pointer(target, "pointermove", 9, 9);

      expect(input.snapshot()).toEqual(resting());
      expect(input.samples()).toEqual([]);
    });

    it("still ends a hold on an up the degenerate fit cannot place", () => {
      pointer(target, "pointerdown", 5, 5);
      viewport = { width: 640, height: 360, scale: 0, offsetX: 0, offsetY: 0 };

      pointer(target, "pointerup", 9, 9);

      expect(input.snapshot()).toMatchObject({ x: 5, y: 5, down: false });
      expect(input.released()).toBe(true);
      expect(
        input.samples().map((sample) => ({
          type: sample.type,
          x: sample.x,
          y: sample.y,
        })),
      ).toEqual([
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

      expect(input.snapshot()).toMatchObject({ x: 8, y: 8, down: false });
      expect(input.released()).toBe(true);
      expect(input.samples().at(-1)).toMatchObject({ type: "up", x: 8, y: 8 });
    });

    it("ignores the coordinates the cancel itself carried", () => {
      pointer(target, "pointerdown", 5, 5);

      pointer(target, "pointercancel", 400, 400);

      expect(input.snapshot()).toMatchObject({ x: 5, y: 5, down: false });
      expect(input.samples().at(-1)).toMatchObject({ type: "up", x: 5, y: 5 });
    });

    it("releases every button the cancelled contact held", () => {
      pointer(target, "pointerdown", 5, 5, { button: 0, buttons: 1 });
      pointer(target, "pointerdown", 5, 5, { button: 2, buttons: 3 });

      target.dispatchEvent(new Event("pointercancel"));

      expect(input.released()).toBe(true);
      expect(input.released("secondary")).toBe(true);
      expect(input.contacts()).toEqual([]);
    });

    it("does nothing with no hold to end", () => {
      target.dispatchEvent(new Event("pointercancel"));

      expect(input.released()).toBe(false);
      expect(input.samples()).toEqual([]);
    });

    it("leaves the primary contact alone when another pointer cancels", () => {
      pointer(target, "pointerdown", 5, 5, { pointerId: 1 });
      target.dispatchEvent(
        Object.assign(new Event("pointercancel"), { pointerId: 2 }),
      );

      expect(input.snapshot().down).toBe(true);
    });
  });

  describe("detach", () => {
    it("stops listening, and is idempotent", () => {
      input.detach();
      input.detach();

      pointer(target, "pointerdown", 5, 5);
      wheel(target, 5, 5);

      expect(input.snapshot()).toEqual(resting());
      expect(input.wheel()).toEqual({ x: 0, y: 0 });
    });
  });
});
