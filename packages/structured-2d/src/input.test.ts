import { describe, expect, it, vi } from "vitest";
import type { PointerSnapshot, SurfaceMetrics, Viewport } from "./contract";
import { InputSystem, TOUCH_LAYOUTS } from "./input";

describe("TOUCH_LAYOUTS", () => {
  it("holds exactly the four documented layouts", () => {
    expect(Object.keys(TOUCH_LAYOUTS).sort()).toEqual([
      "dpad-4",
      "dpad-4-two-buttons",
      "dual-vertical",
      "single-vertical",
    ]);
  });

  it("appends the four menu actions to every entry's own vocabulary", () => {
    // The documented worked example, asserted verbatim.
    expect(TOUCH_LAYOUTS["single-vertical"]?.actions).toEqual([
      "up",
      "down",
      "confirm",
      "back",
      "pause",
      "mute",
    ]);

    for (const [key, layout] of Object.entries(TOUCH_LAYOUTS)) {
      expect(layout.name).toBe(key);
      expect(layout.actions.slice(-4)).toEqual([
        "confirm",
        "back",
        "pause",
        "mute",
      ]);
    }
  });

  it("lists each layout's own vocabulary first, in its documented order", () => {
    const own = (key: string): string[] =>
      TOUCH_LAYOUTS[key]?.actions.slice(0, -4) ?? [];

    expect(own("dual-vertical")).toEqual([
      "p1-up",
      "p1-down",
      "p2-up",
      "p2-down",
    ]);
    expect(own("single-vertical")).toEqual(["up", "down"]);
    expect(own("dpad-4")).toEqual(["up", "down", "left", "right"]);
    expect(own("dpad-4-two-buttons")).toEqual([
      "up",
      "down",
      "left",
      "right",
      "a",
      "b",
    ]);
  });

  it("is read-only down to each entry's action list", () => {
    expect(Object.isFrozen(TOUCH_LAYOUTS)).toBe(true);
    for (const layout of Object.values(TOUCH_LAYOUTS)) {
      expect(Object.isFrozen(layout)).toBe(true);
      expect(Object.isFrozen(layout.actions)).toBe(true);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* InputSystem                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A surface over a bare `EventTarget`, which is exactly the position the
 * engine is in over a canvas with no document behind it. The target is handed
 * back so a test dispatches at the same seam a player's events arrive on.
 */
function surfaceWith(overrides: Partial<SurfaceMetrics> = {}): {
  surface: SurfaceMetrics;
  target: EventTarget;
} {
  const target = new EventTarget();
  return {
    surface: {
      cssWidth: () => 640,
      cssHeight: () => 360,
      dpr: () => 1,
      events: () => target,
      ...overrides,
    },
    target,
  };
}

/** A fit pinned to the stage's own size at a ratio of `1` unless overridden. */
function viewportOf(overrides: Partial<Viewport> = {}): () => Viewport {
  return () => ({
    width: 640,
    height: 360,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    ...overrides,
  });
}

/** A system over a bare target, with the target for dispatching. */
function systemWith(
  options: {
    layout?: string;
    surface?: Partial<SurfaceMetrics>;
    viewport?: Partial<Viewport>;
  } = {},
): { system: InputSystem; target: EventTarget } {
  const { surface, target } = surfaceWith(options.surface);
  const system = new InputSystem({
    surface,
    viewport: viewportOf(options.viewport),
    ...(options.layout === undefined ? {} : { layout: options.layout }),
  });
  return { system, target };
}

/** A keyboard-shaped event, the way the validator docs build one. */
function key(
  target: EventTarget,
  type: "keydown" | "keyup",
  code: string,
  repeat = false,
): void {
  target.dispatchEvent(Object.assign(new Event(type), { code, repeat }));
}

/** The fields a dispatched pointer event may carry beyond its position. */
interface PointerFields {
  isPrimary?: boolean;
  pointerId?: number;
  pointerType?: string;
  button?: number;
  buttons?: number;
}

/** A pointer-shaped event carrying the fields the engine reads. */
function point(
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

/** A wheel-shaped event carrying the fields the engine reads. */
function scroll(
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


describe("InputSystem registration", () => {
  it("defaults kind to digital and resolves it on the registered action", () => {
    const { system } = systemWith();
    system.register("jump", { keys: ["Space"] });
    system.register("throttle", { keys: ["KeyW"], kind: "analog" });

    expect(system.actions()).toEqual([
      { name: "jump", keys: ["Space"], kind: "digital", layout: null },
      { name: "throttle", keys: ["KeyW"], kind: "analog", layout: null },
    ]);
  });

  it("copies the binding's keys rather than holding the caller's array", () => {
    const { system, target } = systemWith();
    const keys = ["KeyA"];
    system.register("fire", { keys });

    keys.push("KeyB");
    key(target, "keydown", "KeyB");

    const reader = system.createReader();
    expect(reader.value("fire")).toBe(0);
  });

  it("accepts any name, layout vocabulary or not", () => {
    const { system } = systemWith({ layout: "dpad-4" });
    system.register("up", { keys: ["ArrowUp"] });
    system.register("warp-drive", { keys: ["KeyQ"] });

    expect(system.actions().map((action) => action.layout)).toEqual([
      "dpad-4",
      null,
    ]);
  });

  it("attributes the menu vocabulary to the selected layout too", () => {
    const { system } = systemWith({ layout: "single-vertical" });
    system.register("pause", { keys: ["KeyP"] });

    expect(system.actions()[0]?.layout).toBe("single-vertical");
  });

  it("re-registering replaces the binding wholesale and keeps its position", () => {
    const { system, target } = systemWith();
    system.register("fire", { keys: ["Space"] });
    system.register("jump", { keys: ["KeyZ"] });

    system.register("fire", { keys: ["Enter"], kind: "analog" });

    expect(system.actions()).toEqual([
      { name: "fire", keys: ["Enter"], kind: "analog", layout: null },
      { name: "jump", keys: ["KeyZ"], kind: "digital", layout: null },
    ]);

    // The old code no longer drives the action.
    key(target, "keydown", "Space");
    expect(system.createReader().value("fire")).toBe(0);
  });

  it("re-registering returns a held action to rest", () => {
    const { system, target } = systemWith();
    system.register("fire", { keys: ["Space"] });
    key(target, "keydown", "Space");
    expect(system.createReader().value("fire")).toBe(1);

    system.register("fire", { keys: ["Space"] });

    // Rest, even though the same code is bound again: the keydown that held it
    // predates the rebind, and no keyup could otherwise ever lower it.
    expect(system.createReader().value("fire")).toBe(0);
  });

  it("re-registering discards an edge the action had armed", () => {
    const { system, target } = systemWith();
    system.register("fire", { keys: ["Space"] });
    const reader = system.createReader();
    key(target, "keydown", "Space");

    system.register("fire", { keys: ["Space"] });

    expect(reader.pressed("fire")).toBe(false);
  });
});

describe("InputSystem layout selection", () => {
  it("reports null when the engine was built without a layout", () => {
    const { system } = systemWith();
    expect(system.layout()).toBeNull();
  });

  it("reports the selected layout as a copy the caller owns", () => {
    const { system } = systemWith({ layout: "dpad-4" });
    const first = system.layout();

    expect(first).toEqual({
      name: "dpad-4",
      actions: [
        "up",
        "down",
        "left",
        "right",
        "confirm",
        "back",
        "pause",
        "mute",
      ],
    });

    first?.actions.pop();
    expect(system.layout()?.actions).toHaveLength(8);
  });

  it("refuses a layout outside the catalogue, naming every valid layout", () => {
    const { surface } = surfaceWith();
    expect(
      () =>
        new InputSystem({ surface, viewport: viewportOf(), layout: "dpad-9" }),
    ).toThrow(
      /"dpad-9".*"dual-vertical".*"single-vertical".*"dpad-4".*"dpad-4-two-buttons"/s,
    );
  });
});

describe("InputSystem values", () => {
  it("reports 0 for an unregistered name, and false for its edge", () => {
    const { system } = systemWith();
    const reader = system.createReader();
    expect(reader.value("missing")).toBe(0);
    expect(reader.pressed("missing")).toBe(false);
  });

  it("reports 1 while a bound key is down and 0 after its release", () => {
    const { system, target } = systemWith();
    system.register("fire", { keys: ["Space"] });
    const reader = system.createReader();

    key(target, "keydown", "Space");
    expect(reader.value("fire")).toBe(1);

    key(target, "keyup", "Space");
    expect(reader.value("fire")).toBe(0);
  });

  it("keeps an action held until the last of several keys is released", () => {
    const { system, target } = systemWith();
    system.register("up", { keys: ["KeyW", "ArrowUp"] });
    const reader = system.createReader();

    key(target, "keydown", "KeyW");
    key(target, "keydown", "ArrowUp");
    key(target, "keyup", "KeyW");
    expect(reader.value("up")).toBe(1);

    key(target, "keyup", "ArrowUp");
    expect(reader.value("up")).toBe(0);
  });

  it("raises every action a shared key is bound to", () => {
    const { system, target } = systemWith();
    system.register("confirm", { keys: ["Enter"] });
    system.register("a", { keys: ["Enter"] });
    const reader = system.createReader();

    key(target, "keydown", "Enter");

    expect(reader.value("confirm")).toBe(1);
    expect(reader.value("a")).toBe(1);
  });

  it("quantizes every non-zero magnitude on a digital action to 1", () => {
    const { system } = systemWith();
    system.register("fire", { keys: [] });
    system.drive("fire", 0.5);

    expect(system.createReader().value("fire")).toBe(1);
  });

  it("reports an analog magnitude as given, with a held key at full deflection", () => {
    const { system, target } = systemWith();
    system.register("steer", { keys: ["KeyD"], kind: "analog" });
    const reader = system.createReader();

    system.drive("steer", 0.25);
    expect(reader.value("steer")).toBe(0.25);

    // A key has one position, so holding it wins over the partial magnitude.
    key(target, "keydown", "KeyD");
    expect(reader.value("steer")).toBe(1);

    key(target, "keyup", "KeyD");
    expect(reader.value("steer")).toBe(0.25);
  });

  it("refuses a non-finite driven magnitude, and ignores an unregistered name", () => {
    const { system } = systemWith();
    system.register("steer", { keys: [], kind: "analog" });

    expect(() => system.drive("steer", Number.NaN)).toThrow(/finite/);
    expect(() => system.drive("missing", 1)).not.toThrow();
  });
});

describe("InputSystem edges", () => {
  it("arms an edge on the rest-to-motion crossing and consumes it per read", () => {
    const { system, target } = systemWith();
    system.register("fire", { keys: ["Space"] });
    const reader = system.createReader();

    key(target, "keydown", "Space");

    expect(reader.pressed("fire")).toBe(true);
    expect(reader.pressed("fire")).toBe(false);
  });

  it("gives each reader its own copy of an armed edge", () => {
    const { system, target } = systemWith();
    system.register("fire", { keys: ["Space"] });
    const first = system.createReader();
    const second = system.createReader();

    key(target, "keydown", "Space");

    expect(first.pressed("fire")).toBe(true);
    expect(second.pressed("fire")).toBe(true);
    expect(first.pressed("fire")).toBe(false);
    expect(second.pressed("fire")).toBe(false);
  });

  it("shows an edge to a reader created after it was armed, within the frame", () => {
    const { system, target } = systemWith();
    system.register("fire", { keys: ["Space"] });
    key(target, "keydown", "Space");

    expect(system.createReader().pressed("fire")).toBe(true);
  });

  it("arms nothing for a key event whose repeat flag is set", () => {
    const { system, target } = systemWith();
    system.register("fire", { keys: ["Space"] });
    const reader = system.createReader();

    key(target, "keydown", "Space");
    expect(reader.pressed("fire")).toBe(true);

    key(target, "keydown", "Space", true);
    expect(reader.pressed("fire")).toBe(false);
  });

  it("treats a second key on an already-held action as a continuation", () => {
    const { system, target } = systemWith();
    system.register("up", { keys: ["KeyW", "ArrowUp"] });
    const reader = system.createReader();

    key(target, "keydown", "KeyW");
    expect(reader.pressed("up")).toBe(true);

    key(target, "keydown", "ArrowUp");
    expect(reader.pressed("up")).toBe(false);
  });

  it("discards every unconsumed edge when the input frame closes", () => {
    const { system, target } = systemWith();
    system.register("fire", { keys: ["Space"] });
    const reader = system.createReader();

    key(target, "keydown", "Space");
    system.endFrame();

    expect(reader.pressed("fire")).toBe(false);
    // The hold itself survives the frame boundary; only the news does not.
    expect(reader.value("fire")).toBe(1);
  });

  it("holds a press across frames as one edge, re-armed only after release", () => {
    const { system, target } = systemWith();
    system.register("fire", { keys: ["Space"] });
    const reader = system.createReader();

    key(target, "keydown", "Space");
    expect(reader.pressed("fire")).toBe(true);
    system.endFrame();
    expect(reader.pressed("fire")).toBe(false);

    key(target, "keyup", "Space");
    key(target, "keydown", "Space");
    expect(reader.pressed("fire")).toBe(true);
  });

  it("reports each of several edges armed within one frame once", () => {
    const { system, target } = systemWith();
    system.register("fire", { keys: ["Space"] });
    const reader = system.createReader();

    key(target, "keydown", "Space");
    key(target, "keyup", "Space");
    key(target, "keydown", "Space");

    expect(reader.pressed("fire")).toBe(true);
    expect(reader.pressed("fire")).toBe(true);
    expect(reader.pressed("fire")).toBe(false);
  });

  it("arms the edge for a driven magnitude by the same crossing rule", () => {
    const { system } = systemWith();
    system.register("steer", { keys: [], kind: "analog" });
    const reader = system.createReader();

    system.drive("steer", 0.5);
    expect(reader.pressed("steer")).toBe(true);

    // Moving while already deflected is not a new press.
    system.drive("steer", 0.75);
    expect(reader.pressed("steer")).toBe(false);
  });
});

describe("InputSystem pointer", () => {
  it("reads (0, 0) and up before the first pointer event, as a fresh copy", () => {
    const { system } = systemWith();
    const reader = system.createReader();

    const snapshot = reader.pointer();
    expect(snapshot).toEqual(resting());

    snapshot.x = 99;
    expect(reader.pointer().x).toBe(0);
  });

  it("maps client positions through origin, ratio, and the inverse viewport", () => {
    const { system, target } = systemWith({
      surface: { dpr: () => 2, origin: () => ({ x: 5, y: 5 }) },
      viewport: { scale: 2, offsetX: 10, offsetY: 20 },
    });
    const reader = system.createReader();

    point(target, "pointerdown", 30, 40);

    // ((30 - 5) * 2 - 10) / 2 = 20 and ((40 - 5) * 2 - 20) / 2 = 25.
    expect(reader.pointer()).toMatchObject({ x: 20, y: 25, down: true });
  });

  it("reads client positions as CSS pixels from the corner with no origin", () => {
    const { system, target } = systemWith();
    const reader = system.createReader();

    point(target, "pointermove", 120, 80);

    expect(reader.pointer()).toMatchObject({ x: 120, y: 80, down: false });
  });

  it("arms press and release edges consumed per reader", () => {
    const { system, target } = systemWith();
    const first = system.createReader();
    const second = system.createReader();

    point(target, "pointerdown", 10, 10);
    expect(first.pointerPressed()).toBe(true);
    expect(first.pointerPressed()).toBe(false);
    expect(second.pointerPressed()).toBe(true);

    point(target, "pointerup", 10, 10);
    expect(first.pointerReleased()).toBe(true);
    expect(second.pointerReleased()).toBe(true);
    expect(second.pointerReleased()).toBe(false);
  });

  it("lists every sample in arrival order without consuming the list", () => {
    const { system, target } = systemWith();
    const reader = system.createReader();

    point(target, "pointerdown", 1, 1);
    point(target, "pointermove", 2, 2);
    point(target, "pointerup", 3, 3);

    const listed = (): unknown =>
      reader
        .pointerSamples()
        .map((sample) => ({ type: sample.type, x: sample.x, y: sample.y }));
    const expected = [
      { type: "down", x: 1, y: 1 },
      { type: "move", x: 2, y: 2 },
      { type: "up", x: 3, y: 3 },
    ];
    expect(listed()).toEqual(expected);
    expect(listed()).toEqual(expected);
  });

  it("moves the pointer without an edge on a down while held or an up while not", () => {
    const { system, target } = systemWith();
    const reader = system.createReader();

    point(target, "pointerdown", 1, 1);
    expect(reader.pointerPressed()).toBe(true);

    // The same button pressed again: the samples keep alternating down and up.
    point(target, "pointerdown", 2, 2);
    expect(reader.pointerPressed()).toBe(false);
    expect(reader.pointer()).toMatchObject({ x: 2, y: 2, down: true });

    point(target, "pointerup", 3, 3);
    expect(reader.pointerReleased()).toBe(true);

    point(target, "pointerup", 4, 4);
    expect(reader.pointerReleased()).toBe(false);
    expect(reader.pointer()).toMatchObject({ x: 4, y: 4, down: false });

    expect(reader.pointerSamples().map((sample) => sample.type)).toEqual([
      "down",
      "move",
      "up",
      "move",
    ]);
  });

  it("ends a cancelled hold as a release at the last known position", () => {
    const { system, target } = systemWith();
    const reader = system.createReader();

    point(target, "pointerdown", 10, 10);
    point(target, "pointermove", 20, 25);
    point(target, "pointercancel", 999, 999);

    expect(reader.pointer()).toMatchObject({ x: 20, y: 25, down: false });
    expect(reader.pointerReleased()).toBe(true);
    expect(reader.pointerSamples().at(-1)).toMatchObject({
      type: "up",
      x: 20,
      y: 25,
    });
  });

  it("drops a down or move over a degenerate fit but still ends a hold", () => {
    let scale = 1;
    const { surface, target } = surfaceWith();
    const system = new InputSystem({
      surface,
      viewport: () => ({
        width: 640,
        height: 360,
        scale,
        offsetX: 0,
        offsetY: 0,
      }),
    });
    const reader = system.createReader();

    point(target, "pointerdown", 10, 10);
    expect(reader.pointerPressed()).toBe(true);
    scale = 0;

    point(target, "pointermove", 50, 50);
    expect(reader.pointer()).toMatchObject({ x: 10, y: 10, down: true });

    point(target, "pointerup", 50, 50);
    expect(reader.pointer()).toMatchObject({ x: 10, y: 10, down: false });
    expect(reader.pointerReleased()).toBe(true);

    // A fresh press has no place on the stage either.
    point(target, "pointerdown", 5, 5);
    expect(reader.pointerPressed()).toBe(false);
  });

  it("caps the listed samples at 1024 while still moving the snapshot", () => {
    const { system, target } = systemWith();
    const reader = system.createReader();

    for (let i = 0; i < 1030; i++) point(target, "pointermove", i, i);

    expect(reader.pointerSamples()).toHaveLength(1024);
    expect(reader.pointer()).toMatchObject({ x: 1029, y: 1029, down: false });
  });

  it("empties the sample list and discards pointer edges at end of frame", () => {
    const { system, target } = systemWith();
    const reader = system.createReader();

    point(target, "pointerdown", 10, 10);
    system.endFrame();

    expect(reader.pointerSamples()).toEqual([]);
    expect(reader.pointerPressed()).toBe(false);
    // The hold itself survives; only the news does not.
    expect(reader.pointer().down).toBe(true);
  });
});

describe("InputSystem pointer buttons", () => {
  it("gives the secondary button its own edges, per reader", () => {
    const { system, target } = systemWith();
    const first = system.createReader();
    const second = system.createReader();

    point(target, "pointerdown", 5, 5, { button: 2, buttons: 2 });

    expect(first.pointerPressed("secondary")).toBe(true);
    expect(first.pointerPressed("secondary")).toBe(false);
    expect(second.pointerPressed("secondary")).toBe(true);
    expect(first.pointerPressed()).toBe(false);
    expect(first.pointer()).toMatchObject({
      down: true,
      buttons: ["secondary"],
    });

    point(target, "pointerup", 5, 5, { button: 2, buttons: 0 });

    expect(first.pointerReleased("secondary")).toBe(true);
    expect(first.pointerReleased()).toBe(false);
  });

  it("keeps the contact while one of two held buttons is released", () => {
    const { system, target } = systemWith();
    const reader = system.createReader();

    point(target, "pointerdown", 5, 5, { button: 0, buttons: 1 });
    point(target, "pointerdown", 5, 5, { button: 2, buttons: 3 });

    expect(reader.pointerPressed("secondary")).toBe(true);
    expect(reader.pointer().buttons).toEqual(["primary", "secondary"]);

    point(target, "pointerup", 5, 5, { button: 2, buttons: 1 });

    expect(reader.pointerReleased("secondary")).toBe(true);
    expect(reader.pointerReleased()).toBe(false);
    expect(reader.pointer()).toMatchObject({ down: true, buttons: ["primary"] });
    expect(reader.pointerSamples().map((sample) => sample.type)).toEqual([
      "down",
      "move",
      "move",
    ]);
  });

  it("names on each sample the button whose state it reports", () => {
    const { system, target } = systemWith();
    const reader = system.createReader();

    point(target, "pointerdown", 5, 5, { button: 0, buttons: 1 });
    point(target, "pointermove", 6, 6, { button: -1, buttons: 1 });
    point(target, "pointerup", 6, 6, { button: 0, buttons: 0 });

    expect(reader.pointerSamples().map((sample) => sample.button)).toEqual([
      "primary",
      null,
      "primary",
    ]);
  });

  it("maps the auxiliary button off its own index", () => {
    const { system, target } = systemWith();
    const reader = system.createReader();

    point(target, "pointerdown", 5, 5, { button: 1, buttons: 4 });

    expect(reader.pointerPressed("auxiliary")).toBe(true);
    expect(reader.pointer().buttons).toEqual(["auxiliary"]);
  });

  it("releases every button a cancelled contact held", () => {
    const { system, target } = systemWith();
    const reader = system.createReader();

    point(target, "pointerdown", 5, 5, { button: 0, buttons: 1 });
    point(target, "pointerdown", 5, 5, { button: 2, buttons: 3 });
    target.dispatchEvent(new Event("pointercancel"));

    expect(reader.pointerReleased()).toBe(true);
    expect(reader.pointerReleased("secondary")).toBe(true);
    expect(reader.pointerContacts()).toEqual([]);
  });
});

describe("InputSystem pointer devices and contacts", () => {
  it("reports the device that drove the pointer", () => {
    const { system, target } = systemWith();
    const reader = system.createReader();

    point(target, "pointerdown", 5, 5, { pointerType: "touch" });

    expect(reader.pointer().device).toBe("touch");
    expect(reader.pointerSamples()[0]?.device).toBe("touch");
  });

  it("reads an unrecognized pointer type as a mouse", () => {
    const { system, target } = systemWith();
    const reader = system.createReader();

    point(target, "pointerdown", 5, 5, { pointerType: "trackball" });

    expect(reader.pointer().device).toBe("mouse");
  });

  it("holds the primary button for a touch in contact", () => {
    const { system, target } = systemWith();
    const reader = system.createReader();

    point(target, "pointerdown", 5, 5, {
      pointerType: "touch",
      button: 0,
      buttons: 1,
    });

    expect(reader.pointerPressed()).toBe(true);
    expect(reader.pointer()).toMatchObject({ down: true, buttons: ["primary"] });
  });

  it("lists every pointer in contact, in contact order", () => {
    const { system, target } = systemWith();
    const reader = system.createReader();

    point(target, "pointerdown", 5, 5, { pointerId: 1, pointerType: "touch" });
    point(target, "pointerdown", 9, 9, {
      pointerId: 2,
      pointerType: "touch",
      isPrimary: false,
    });

    expect(reader.pointerContacts()).toEqual([
      { id: 1, x: 5, y: 5, primary: true, device: "touch", buttons: ["primary"] },
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

  it("leaves the snapshot and the edges to the primary pointer", () => {
    const { system, target } = systemWith();
    const reader = system.createReader();

    point(target, "pointerdown", 5, 5, { pointerId: 1 });
    expect(reader.pointerPressed()).toBe(true);

    point(target, "pointerdown", 9, 9, { pointerId: 2, isPrimary: false });
    point(target, "pointerup", 9, 9, { pointerId: 2, isPrimary: false });

    expect(reader.pointerPressed()).toBe(false);
    expect(reader.pointerReleased()).toBe(false);
    expect(reader.pointer()).toMatchObject({ x: 5, y: 5, down: true });
  });

  it("reads an absent pointerId as 0, whatever the event says about isPrimary", () => {
    // A browser always supplies the field, so an event without one was
    // dispatched by hand and has no way of implying a second pointer: two
    // contacts are named by giving each its own `pointerId`.
    const { system, target } = systemWith();
    const reader = system.createReader();

    point(target, "pointerdown", 5, 5, { isPrimary: false });

    expect(reader.pointerContacts()).toEqual([
      {
        id: 0,
        x: 5,
        y: 5,
        primary: false,
        device: "mouse",
        buttons: ["primary"],
      },
    ]);
    expect(reader.pointerSamples()[0]?.id).toBe(0);
  });

  it("folds a second unidentified pointer into the same contact", () => {
    const { system, target } = systemWith();
    const reader = system.createReader();

    point(target, "pointerdown", 5, 5);
    point(target, "pointerdown", 9, 9, { isPrimary: false });

    expect(reader.pointerContacts()).toHaveLength(1);
    expect(reader.pointerContacts()[0]?.id).toBe(0);
  });

  it("keeps its contacts across a closing frame and drops a released one", () => {
    const { system, target } = systemWith();
    const reader = system.createReader();

    point(target, "pointerdown", 5, 5, { pointerId: 1 });
    system.endFrame();
    expect(reader.pointerContacts()).toHaveLength(1);

    point(target, "pointerup", 5, 5, { pointerId: 1 });
    expect(reader.pointerContacts()).toEqual([]);
  });
});

describe("InputSystem wheel", () => {
  it("accumulates travel over the frame, in logical units", () => {
    const { system, target } = systemWith();
    const reader = system.createReader();

    scroll(target, 10, -20);
    scroll(target, 5, 0);

    expect(reader.wheel()).toEqual({ x: 15, y: -20 });
  });

  it("maps travel through the ratio and the fit", () => {
    const { system, target } = systemWith({
      surface: { dpr: () => 2 },
      viewport: { scale: 0.5 },
    });
    const reader = system.createReader();

    scroll(target, 0, 10);

    expect(reader.wheel()).toEqual({ x: 0, y: 40 });
  });

  it("converts a wheel reporting lines and one reporting pages", () => {
    const { system, target } = systemWith();
    const reader = system.createReader();

    scroll(target, 0, 2, 1);
    expect(reader.wheel().y).toBe(32);

    system.endFrame();

    scroll(target, 0, 1, 2);
    expect(reader.wheel().y).toBe(360);
  });

  it("returns to zero when the frame closes", () => {
    const { system, target } = systemWith();
    const reader = system.createReader();

    scroll(target, 1, 1);
    system.endFrame();

    expect(reader.wheel()).toEqual({ x: 0, y: 0 });
  });

  it("ignores an event with no numeric delta", () => {
    const { system, target } = systemWith();
    const reader = system.createReader();

    target.dispatchEvent(new Event("wheel"));

    expect(reader.wheel()).toEqual({ x: 0, y: 0 });
  });
});

describe("InputSystem gesture ownership", () => {
  it("claims the surface's gestures on attach and gives them back on detach", () => {
    const give = vi.fn();
    const claimGestures = vi.fn(() => give);
    const { system } = systemWith({ surface: { claimGestures } });

    expect(claimGestures).toHaveBeenCalledTimes(1);
    expect(give).not.toHaveBeenCalled();

    system.detach();
    system.detach();

    expect(give).toHaveBeenCalledTimes(1);
  });

  it("captures a pointer as it comes into contact and releases it as it leaves", () => {
    const capturePointer = vi.fn();
    const releasePointerCapture = vi.fn();
    const { system, target } = systemWith({
      surface: { capturePointer, releasePointerCapture },
    });

    point(target, "pointerdown", 5, 5, { pointerId: 3 });
    expect(capturePointer).toHaveBeenCalledWith(3);
    expect(releasePointerCapture).not.toHaveBeenCalled();

    point(target, "pointerup", 5, 5, { pointerId: 3 });
    expect(releasePointerCapture).toHaveBeenCalledWith(3);
  });

  it("releases a still-held capture when it detaches", () => {
    const releasePointerCapture = vi.fn();
    const { system, target } = systemWith({
      surface: { capturePointer: vi.fn(), releasePointerCapture },
    });

    point(target, "pointerdown", 5, 5, { pointerId: 4 });
    system.detach();

    expect(releasePointerCapture).toHaveBeenCalledWith(4);
  });

  it("works over a surface supplying none of the three", () => {
    const { system, target } = systemWith();
    const reader = system.createReader();

    point(target, "pointerdown", 5, 5);

    expect(reader.pointerPressed()).toBe(true);
  });
});

describe("InputSystem detach", () => {
  it("stops listening for keys and the pointer, idempotently", () => {
    const { system, target } = systemWith();
    system.register("fire", { keys: ["Space"] });
    const reader = system.createReader();

    system.detach();
    system.detach();

    key(target, "keydown", "Space");
    point(target, "pointerdown", 10, 10);

    expect(reader.value("fire")).toBe(0);
    expect(reader.pointer()).toEqual(resting());
  });
});
