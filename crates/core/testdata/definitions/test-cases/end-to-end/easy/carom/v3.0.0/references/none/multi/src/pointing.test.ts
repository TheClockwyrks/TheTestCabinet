// The pointer and touch layer: what it heard, where it puts it, and how it pairs
// a press with its release.
//
// Nothing here is about the menus — which item a position is over is the game's
// (`src/menu.ts`), and it is checked over the real game in `src/game.test.ts`.
// What is checked here is the layer beneath: that a mouse and a finger are read
// apart, that every position lands in the field's logical units through the same
// fit the game draws under, that samples are queued in arrival order and drained
// once, and that an `up` carries the point its press landed on.

import { describe, expect, it } from "vitest";
import { FIELD_H, FIELD_W } from "./constants";
import { Pointing, type PointerSample } from "./pointing";
import { fitViewport, toLogical } from "./viewport";

/** A letterboxed fit: a 1280x720 field inside a 1600x720 element at dpr 2. */
const VIEW = fitViewport(FIELD_W, FIELD_H, 1600, 720, 2);

/** The client position, in CSS pixels, of a logical point under {@link VIEW}. */
function client(x: number, y: number): { x: number; y: number } {
  return {
    x: (VIEW.offsetX + x * VIEW.scale) / 2,
    y: (VIEW.offsetY + y * VIEW.scale) / 2,
  };
}

class PointerEventLike extends Event {
  readonly clientX: number;
  readonly clientY: number;

  constructor(
    type: string,
    at: { x: number; y: number },
    readonly pointerType = "mouse",
  ) {
    super(type);
    this.clientX = at.x;
    this.clientY = at.y;
  }
}

class TouchEventLike extends Event {
  readonly changedTouches: readonly { clientX: number; clientY: number }[];

  constructor(type: string, points: readonly { x: number; y: number }[]) {
    super(type);
    this.changedTouches = points.map((at) => ({
      clientX: at.x,
      clientY: at.y,
    }));
  }
}

interface Rig {
  target: EventTarget;
  pointing: Pointing;
  mouse(type: string, x: number, y: number, pointerType?: string): void;
  touch(type: string, points: readonly { x: number; y: number }[]): void;
  take(): PointerSample[];
}

function rig(): Rig {
  const target = new EventTarget();
  const pointing = new Pointing(target, (clientX, clientY) =>
    toLogical(VIEW, clientX, clientY, 2),
  );
  return {
    target,
    pointing,
    mouse: (type, x, y, pointerType = "mouse") =>
      target.dispatchEvent(
        new PointerEventLike(type, client(x, y), pointerType),
      ),
    touch: (type, points) =>
      target.dispatchEvent(
        new TouchEventLike(
          type,
          points.map((at) => client(at.x, at.y)),
        ),
      ),
    take: () => pointing.take(),
  };
}

describe("the mouse", () => {
  it("reports a move in logical units, through the letterboxed fit", () => {
    const r = rig();
    r.mouse("pointermove", 400, 250);
    const [sample] = r.take();
    expect(sample.source).toBe("mouse");
    expect(sample.phase).toBe("move");
    expect(sample.x).toBeCloseTo(400, 6);
    expect(sample.y).toBeCloseTo(250, 6);
    expect(sample.from).toBeNull();
  });

  it("pairs a release with the point its press landed on", () => {
    const r = rig();
    r.mouse("pointerdown", 100, 100);
    r.mouse("pointermove", 500, 300);
    r.mouse("pointerup", 500, 300);

    const samples = r.take();
    expect(samples.map((s) => s.phase)).toEqual(["down", "move", "up"]);
    const up = samples[2];
    expect(up.from?.x).toBeCloseTo(100, 6);
    expect(up.from?.y).toBeCloseTo(100, 6);
    expect(up.x).toBeCloseTo(500, 6);
  });

  it("reports a release with no press behind it as unpaired", () => {
    const r = rig();
    r.mouse("pointerup", 300, 300);
    expect(r.take()[0].from).toBeNull();
  });

  it("forgets a press the browser cancelled", () => {
    const r = rig();
    r.mouse("pointerdown", 100, 100);
    r.mouse("pointercancel", 100, 100);
    r.mouse("pointerup", 100, 100);
    const samples = r.take();
    expect(samples[samples.length - 1].from).toBeNull();
  });

  it("leaves a finger to the touch listeners", () => {
    const r = rig();
    r.mouse("pointerdown", 100, 100, "touch");
    r.mouse("pointermove", 100, 100, "touch");
    r.mouse("pointerup", 100, 100, "touch");
    r.mouse("pointercancel", 100, 100, "touch");
    expect(r.take()).toEqual([]);
  });

  it("ignores an event carrying no position at all", () => {
    const r = rig();
    r.target.dispatchEvent(new Event("pointermove"));
    expect(r.take()).toEqual([]);
  });
});

describe("the finger", () => {
  it("reports a landing, a travel, and a lift, in that order", () => {
    const r = rig();
    r.touch("touchstart", [{ x: 200, y: 200 }]);
    r.touch("touchmove", [{ x: 600, y: 400 }]);
    r.touch("touchend", [{ x: 600, y: 400 }]);

    const samples = r.take();
    expect(samples.map((s) => [s.source, s.phase])).toEqual([
      ["touch", "down"],
      ["touch", "move"],
      ["touch", "up"],
    ]);
    expect(samples[2].from?.x).toBeCloseTo(200, 6);
  });

  it("lifts at the contact's last known place when the lift carries none", () => {
    const r = rig();
    r.touch("touchstart", [{ x: 200, y: 200 }]);
    r.touch("touchmove", [{ x: 640, y: 360 }]);
    r.touch("touchend", []);

    const up = r.take()[2];
    expect(up.phase).toBe("up");
    expect(up.x).toBeCloseTo(640, 6);
    expect(up.y).toBeCloseTo(360, 6);
  });

  it("drops a lift with nothing behind it at all", () => {
    const r = rig();
    r.touch("touchend", []);
    expect(r.take()).toEqual([]);
  });

  it("forgets a contact the browser cancelled", () => {
    const r = rig();
    r.touch("touchstart", [{ x: 200, y: 200 }]);
    r.target.dispatchEvent(new Event("touchcancel"));
    r.touch("touchend", [{ x: 200, y: 200 }]);
    const samples = r.take();
    expect(samples[samples.length - 1].from).toBeNull();
  });

  it("reads a contact apart from the mouse", () => {
    const r = rig();
    r.mouse("pointerdown", 100, 100);
    r.touch("touchstart", [{ x: 500, y: 500 }]);
    r.touch("touchend", [{ x: 500, y: 500 }]);
    r.mouse("pointerup", 100, 100);

    const samples = r.take();
    // Each release pairs with its OWN press, not with whichever came last.
    const touchUp = samples.find(
      (s) => s.source === "touch" && s.phase === "up",
    );
    const mouseUp = samples.find(
      (s) => s.source === "mouse" && s.phase === "up",
    );
    expect(touchUp?.from?.x).toBeCloseTo(500, 6);
    expect(mouseUp?.from?.x).toBeCloseTo(100, 6);
  });
});

describe("the queue", () => {
  it("empties on a read, so a sample is spent on one frame", () => {
    const r = rig();
    r.mouse("pointermove", 200, 200);
    expect(r.take()).toHaveLength(1);
    expect(r.take()).toEqual([]);
  });

  it("can be discarded without being acted on", () => {
    const r = rig();
    r.mouse("pointermove", 200, 200);
    r.pointing.clear();
    expect(r.take()).toEqual([]);
  });

  it("keeps the newest samples when nothing drains it", () => {
    const r = rig();
    for (let i = 0; i < 400; i++) r.mouse("pointermove", 100 + i * 0.5, 200);
    const samples = r.take();
    expect(samples).toHaveLength(256);
    // The last event dispatched is the last one held.
    expect(samples[samples.length - 1].x).toBeCloseTo(100 + 399 * 0.5, 6);
  });

  it("hears nothing more once it is detached", () => {
    const r = rig();
    r.pointing.detach();
    r.pointing.detach(); // idempotent, because teardown races
    r.mouse("pointermove", 200, 200);
    r.touch("touchstart", [{ x: 200, y: 200 }]);
    expect(r.take()).toEqual([]);
  });

  it("drops a position the fit cannot map", () => {
    const target = new EventTarget();
    const collapsed = new Pointing(target, () => ({
      x: Number.NaN,
      y: Number.NaN,
    }));
    target.dispatchEvent(new PointerEventLike("pointermove", { x: 10, y: 10 }));
    expect(collapsed.take()).toEqual([]);
  });
});
