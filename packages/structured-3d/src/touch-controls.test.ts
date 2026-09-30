import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InputReader, SurfaceMetrics, Viewport } from "./contract";
import type { EngineEventMap } from "./events";
import { InputSystem, TOUCH_LAYOUTS } from "./input";
import {
  ACTION_ATTRIBUTE,
  ACTIONS_ATTRIBUTE,
  CONTAINER_ATTRIBUTE,
  DEAD_ZONE,
  TouchControls,
  axisDeflection,
  layoutControls,
  padDirections,
  stickDeflection,
} from "./touch-controls";

/**
 * The controls are driven the way a player and a check both drive them: by
 * dispatching pointer-shaped events, at the document for the visibility rule and
 * at a control's element for the control itself. The input system behind them is
 * the real one, read through a reader as a player controller reads it, so what
 * is asserted is what a game would read.
 *
 * jsdom has no `PointerEvent` and no `setPointerCapture`, and it lays nothing
 * out, so the events are plain `Event`s carrying the fields the listeners read
 * (as `input.test.ts` dispatches them), the capture is stubbed where a test is
 * about it, and a control's rect is pinned by hand where a test measures a
 * contact against it.
 */

const VIEWPORT: Viewport = {
  width: 640,
  height: 360,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
};

/** A surface whose event target is `target`: the document, or a bare target. */
function surfaceOver(target: EventTarget): SurfaceMetrics {
  return {
    cssWidth: () => 640,
    cssHeight: () => 360,
    dpr: () => 1,
    events: () => target,
  };
}

/** The fields a dispatched pointer event may carry beyond its type. */
interface PointerFields {
  pointerId?: number;
  pointerType?: string;
  clientX?: number;
  clientY?: number;
}

type PointerType =
  | "pointerdown"
  | "pointermove"
  | "pointerup"
  | "pointercancel";

/**
 * A pointer-shaped plain event, bubbling as a browser's would, so one dispatched
 * at a control reaches the document unless the control stops it.
 */
function pointer(
  target: EventTarget,
  type: PointerType,
  fields: PointerFields = {},
): Event {
  const event = Object.assign(
    new Event(type, { bubbles: true, cancelable: true }),
    fields,
  );
  target.dispatchEvent(event);
  return event;
}

/** A touch, which is what shows the controls. */
function touch(target: EventTarget, fields: PointerFields = {}): Event {
  return pointer(target, "pointerdown", { pointerType: "touch", ...fields });
}

function keyDown(target: EventTarget, code = "KeyA"): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
}

/** Pins a control's rect, since jsdom lays nothing out. */
function pin(
  element: Element,
  rect: { left: number; top: number; width: number; height: number },
): void {
  element.getBoundingClientRect = (): DOMRect =>
    ({
      ...rect,
      x: rect.left,
      y: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      toJSON: () => rect,
    }) as DOMRect;
}

/** One emitted event, as the bus would have carried it. */
type Emitted = {
  [K in keyof EngineEventMap]: { event: K; payload: EngineEventMap[K] };
}[keyof EngineEventMap];

/** Everything a test builds around one set of controls. */
interface Rig {
  controls: TouchControls;
  input: InputSystem;
  /** A reader over the input system, as a player controller holds one. */
  reader: InputReader;
  emitted: Emitted[];
  container: HTMLElement;
  /** The element carrying `data-action="<action>"`, first in document order. */
  control(action: string): HTMLElement;
  /** The element whose `data-actions` starts with `action`. */
  multi(action: string): HTMLElement;
}

const rigs: Rig[] = [];

/**
 * Controls over the document for `layout`, with every action of its vocabulary
 * registered digital except those named in `analog`, and the rig disposed of by
 * the teardown whatever the test does.
 */
function rig(layout: string, analog: string[] = []): Rig {
  const surface = surfaceOver(document);
  const input = new InputSystem({ surface, viewport: () => VIEWPORT, layout });
  const selected = TOUCH_LAYOUTS[layout];
  if (selected === undefined) throw new Error(`no layout ${layout}`);
  for (const action of selected.actions) {
    input.register(action, {
      keys: [],
      kind: analog.includes(action) ? "analog" : "digital",
    });
  }
  const emitted: Emitted[] = [];
  const controls = new TouchControls({
    surface,
    actions: input,
    layout: selected,
    emit: (event, payload) => {
      emitted.push({ event, payload } as Emitted);
    },
  });
  const container = document.querySelector<HTMLElement>(
    `[${CONTAINER_ATTRIBUTE}]`,
  );
  if (container === null) throw new Error("no container was drawn");
  const built: Rig = {
    controls,
    input,
    reader: input.createReader(),
    emitted,
    container,
    control: (action) => {
      const found = container.querySelector<HTMLElement>(
        `[${ACTION_ATTRIBUTE}="${action}"]`,
      );
      if (found === null) throw new Error(`no control drives ${action}`);
      return found;
    },
    multi: (action) => {
      const found = container.querySelector<HTMLElement>(
        `[${ACTIONS_ATTRIBUTE}^="${action} "]`,
      );
      if (found === null) throw new Error(`no stick or pad drives ${action}`);
      return found;
    },
  };
  rigs.push(built);
  return built;
}

/** Whether the container is hidden the one way the module hides it. */
function hidden(container: HTMLElement): boolean {
  return container.hidden && container.style.display === "none";
}

beforeEach(() => {
  document.body.replaceChildren();
});

afterEach(() => {
  for (const built of rigs.splice(0)) {
    built.controls.detach();
    built.input.detach();
  }
  document.body.replaceChildren();
  document.head.replaceChildren();
  vi.restoreAllMocks();
});

describe("the overlay", () => {
  it("is drawn in the document's body, marked with the layout, hidden", () => {
    const { container, controls, emitted } = rig("dual-stick");

    expect(container.parentElement).toBe(document.body);
    expect(container.getAttribute(CONTAINER_ATTRIBUTE)).toBe("dual-stick");
    expect(hidden(container)).toBe(true);
    expect(controls.state()).toEqual({ layout: "dual-stick", visible: false });
    expect(emitted).toEqual([]);
  });

  it("injects its stylesheet once, scoped by the container's marker", () => {
    rig("dual-stick");

    const sheets = document.querySelectorAll("style");
    expect(sheets).toHaveLength(1);
    expect(sheets[0]?.textContent).toContain(`[${CONTAINER_ATTRIBUTE}]`);
    expect(sheets[0]?.textContent).toContain("safe-area-inset");
  });

  it("hands out a fresh state each read", () => {
    const { controls } = rig("dual-stick");
    const first = controls.state();
    if (first === null) throw new Error("no state");
    first.visible = true;

    expect(controls.state()?.visible).toBe(false);
  });

  it.each(Object.keys(TOUCH_LAYOUTS))(
    "draws a control for every action %s speaks",
    (name) => {
      const { container } = rig(name);

      for (const action of TOUCH_LAYOUTS[name]?.actions ?? []) {
        const single = container.querySelector(
          `[${ACTION_ATTRIBUTE}="${action}"]`,
        );
        const listed = [
          ...container.querySelectorAll(`[${ACTIONS_ATTRIBUTE}]`),
        ].some((element) =>
          (element.getAttribute(ACTIONS_ATTRIBUTE) ?? "")
            .split(" ")
            .includes(action),
        );
        expect(single !== null || listed, action).toBe(true);
      }
    },
  );

  it("marks a pad with every action it drives, first one named", () => {
    const { multi } = rig("dpad-4-two-buttons");
    const pad = multi("up");

    expect(pad.getAttribute(ACTIONS_ATTRIBUTE)).toBe("up down left right");
    expect(pad.getAttribute(ACTION_ATTRIBUTE)).toBe("up");
  });

  it("marks each stick with its four directions, up first", () => {
    const { multi } = rig("dual-stick");

    expect(multi("move-up").getAttribute(ACTIONS_ATTRIBUTE)).toBe(
      "move-up move-down move-left move-right",
    );
    expect(multi("move-up").getAttribute(ACTION_ATTRIBUTE)).toBe("move-up");
    expect(multi("look-up").getAttribute(ACTIONS_ATTRIBUTE)).toBe(
      "look-up look-down look-left look-right",
    );
  });

  it("draws the menu strip's four buttons in the documented order", () => {
    const { container } = rig("single-stick");
    const strip = container.querySelector(".menu");

    expect(
      [...(strip?.children ?? [])].map((button) =>
        button.getAttribute(ACTION_ATTRIBUTE),
      ),
    ).toEqual(["confirm", "back", "pause", "mute"]);
  });

  it("refuses a layout the catalogue holds but the drawings do not, naming it", () => {
    expect(() => layoutControls({ name: "not-drawn", actions: [] })).toThrow(
      /not-drawn/,
    );
  });
});

describe("appearance", () => {
  it("shows on a touch pointerdown at the surface's target, and says so", () => {
    const { container, controls, emitted } = rig("single-stick");

    touch(document);

    expect(hidden(container)).toBe(false);
    expect(controls.state()).toEqual({ layout: "single-stick", visible: true });
    expect(emitted).toEqual([
      { event: "touch-controls:shown", payload: { layout: "single-stick" } },
    ]);
  });

  it("stays hidden on a touch that only moves", () => {
    const { container } = rig("single-stick");

    pointer(document, "pointermove", { pointerType: "touch" });

    expect(hidden(container)).toBe(true);
  });

  it.each([
    ["a keydown", (): void => keyDown(document), "keyboard"],
    [
      "a mouse pointerdown",
      (): void => {
        pointer(document, "pointerdown", { pointerType: "mouse" });
      },
      "mouse",
    ],
    [
      "a mouse pointermove",
      (): void => {
        pointer(document, "pointermove", { pointerType: "mouse" });
      },
      "mouse",
    ],
    [
      "a pen pointerdown",
      (): void => {
        pointer(document, "pointerdown", { pointerType: "pen" });
      },
      "pen",
    ],
  ])("hides on %s, naming the reason", (_, act, reason) => {
    const { container, controls, emitted } = rig("single-stick");
    touch(document);
    emitted.length = 0;

    act();

    expect(hidden(container)).toBe(true);
    expect(controls.state()?.visible).toBe(false);
    expect(emitted).toEqual([
      {
        event: "touch-controls:hidden",
        payload: { layout: "single-stick", reason },
      },
    ]);
  });

  it("comes back on the next touch", () => {
    const { container, emitted } = rig("single-stick");
    touch(document);
    keyDown(document);
    emitted.length = 0;

    touch(document);

    expect(hidden(container)).toBe(false);
    expect(emitted.map((entry) => entry.event)).toEqual([
      "touch-controls:shown",
    ]);
  });

  it("reports each transition once, however many inputs repeat it", () => {
    const { emitted } = rig("single-stick");

    keyDown(document);
    touch(document);
    touch(document);
    pointer(document, "pointermove", { pointerType: "mouse" });
    pointer(document, "pointermove", { pointerType: "mouse" });
    keyDown(document);

    expect(emitted.map((entry) => entry.event)).toEqual([
      "touch-controls:shown",
      "touch-controls:hidden",
    ]);
  });

  it("reads a pointer event carrying no pointerType as a mouse, as the input system does", () => {
    const { container } = rig("single-stick");
    touch(document);

    pointer(document, "pointerdown");

    expect(hidden(container)).toBe(true);
  });

  it("leaves the touch that reveals it to reach the game's pointer", () => {
    const { container, reader } = rig("single-stick");

    touch(document, { pointerId: 7, clientX: 10, clientY: 10 });

    expect(hidden(container)).toBe(false);
    expect(reader.pointerContacts()).toHaveLength(1);
    expect(reader.pointer()).toMatchObject({ x: 10, y: 10, down: true });
  });
});

describe("a button", () => {
  it("drives its action to 1 on pointerdown, arming the edge once", () => {
    const { control, reader } = rig("single-stick");
    touch(document);

    pointer(control("confirm"), "pointerdown", { pointerType: "touch" });

    expect(reader.value("confirm")).toBe(1);
    expect(reader.pressed("confirm")).toBe(true);
    expect(reader.pressed("confirm")).toBe(false);
  });

  it("drives its action back to 0 on pointerup", () => {
    const { control, reader } = rig("single-stick");
    touch(document);
    pointer(control("confirm"), "pointerdown", { pointerType: "touch" });

    pointer(control("confirm"), "pointerup", { pointerType: "touch" });

    expect(reader.value("confirm")).toBe(0);
  });

  it("drives its action back to 0 on pointercancel", () => {
    const { control, reader } = rig("single-stick");
    touch(document);
    pointer(control("confirm"), "pointerdown", { pointerType: "touch" });

    pointer(control("confirm"), "pointercancel", { pointerType: "touch" });

    expect(reader.value("confirm")).toBe(0);
  });

  it("arms the edge again on the next press, as a key would", () => {
    const { control, input, reader } = rig("single-stick");
    touch(document);
    pointer(control("confirm"), "pointerdown", { pointerType: "touch" });
    pointer(control("confirm"), "pointerup", { pointerType: "touch" });
    input.endFrame();

    pointer(control("confirm"), "pointerdown", { pointerType: "touch" });

    expect(reader.pressed("confirm")).toBe(true);
  });

  it("is held by the first pointer alone; a second finger changes nothing", () => {
    const { control, reader } = rig("single-stick");
    touch(document);
    pointer(control("confirm"), "pointerdown", { pointerId: 1 });
    pointer(control("confirm"), "pointerdown", { pointerId: 2 });

    pointer(control("confirm"), "pointerup", { pointerId: 2 });
    expect(reader.value("confirm")).toBe(1);

    pointer(control("confirm"), "pointerup", { pointerId: 1 });
    expect(reader.value("confirm")).toBe(0);
  });

  it("keeps an action held while another control still holds it", () => {
    // `dpad-4` draws confirm twice: the large thumb button and the menu's.
    const { container, reader } = rig("dpad-4");
    touch(document);
    const [large, menu] = container.querySelectorAll<HTMLElement>(
      `[${ACTION_ATTRIBUTE}="confirm"]`,
    );
    if (large === undefined || menu === undefined) {
      throw new Error("dpad-4 draws confirm twice");
    }

    pointer(large, "pointerdown", { pointerId: 1 });
    pointer(menu, "pointerdown", { pointerId: 2 });
    pointer(large, "pointerup", { pointerId: 1 });
    expect(reader.value("confirm")).toBe(1);

    pointer(menu, "pointerup", { pointerId: 2 });
    expect(reader.value("confirm")).toBe(0);
  });

  it("drives a and b above the look stick on dual-stick-two-buttons", () => {
    const { control, reader } = rig("dual-stick-two-buttons");
    touch(document);

    pointer(control("a"), "pointerdown", { pointerId: 1 });
    pointer(control("b"), "pointerdown", { pointerId: 2 });

    expect(reader.value("a")).toBe(1);
    expect(reader.value("b")).toBe(1);
  });
});

describe("a stick", () => {
  const rect = { left: 0, top: 100, width: 200, height: 200 };
  const centre = {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
  const half = rect.width / 2;
  /** The raw radial fraction that reads as `deflection`, inverting the rescale. */
  const raw = (deflection: number): number =>
    deflection * (1 - DEAD_ZONE) + DEAD_ZONE;
  /** Where a straight push up to `deflection` puts the contact. */
  const up = (deflection: number): { clientX: number; clientY: number } => ({
    clientX: centre.x,
    clientY: centre.y - raw(deflection) * half,
  });

  it("hands an analog action the fraction the thumb pushed it to", () => {
    const { multi, reader } = rig("single-stick", ["move-up", "move-down"]);
    touch(document);
    const stick = multi("move-up");
    pin(stick, rect);

    pointer(stick, "pointerdown", up(0.5));

    expect(reader.value("move-up")).toBeCloseTo(0.5);
    expect(reader.value("move-down")).toBe(0);
    expect(reader.value("move-left")).toBe(0);
    expect(reader.value("move-right")).toBe(0);
  });

  it("splits a diagonal push into two components, and leaves the other two at rest", () => {
    const { multi, reader } = rig("single-stick", [
      "move-up",
      "move-down",
      "move-left",
      "move-right",
    ]);
    touch(document);
    const stick = multi("move-up");
    pin(stick, rect);
    // Up and to the right at 45°, pushed to a radial deflection of 0.5.
    const along = (raw(0.5) * half) / Math.SQRT2;

    pointer(stick, "pointerdown", {
      clientX: centre.x + along,
      clientY: centre.y - along,
    });

    expect(reader.value("move-up")).toBeCloseTo(0.5 / Math.SQRT2);
    expect(reader.value("move-right")).toBeCloseTo(0.5 / Math.SQRT2);
    expect(reader.value("move-down")).toBe(0);
    expect(reader.value("move-left")).toBe(0);
  });

  it("follows the thumb across the centre, and quantizes a digital action", () => {
    const { multi, reader } = rig("single-stick", ["move-up"]);
    touch(document);
    const stick = multi("move-up");
    pin(stick, rect);

    pointer(stick, "pointerdown", up(0.5));
    pointer(stick, "pointermove", {
      clientX: centre.x,
      clientY: centre.y + raw(0.5) * half,
    });

    expect(reader.value("move-up")).toBe(0);
    // `move-down` is digital: half a deflection reads as held.
    expect(reader.value("move-down")).toBe(1);
  });

  it("reads the dead zone about its centre as rest", () => {
    const { multi, reader } = rig("single-stick", ["move-up", "move-down"]);
    touch(document);
    const stick = multi("move-up");
    pin(stick, rect);

    pointer(stick, "pointerdown", {
      clientX: centre.x + 5,
      clientY: centre.y - 5,
    });

    for (const action of ["move-up", "move-down", "move-left", "move-right"]) {
      expect(reader.value(action), action).toBe(0);
    }
  });

  it("clamps a thumb that slid past its rim at full deflection", () => {
    const { multi, reader } = rig("single-stick", ["move-up", "move-down"]);
    touch(document);
    const stick = multi("move-up");
    pin(stick, rect);

    pointer(stick, "pointerdown", up(0.5));
    pointer(stick, "pointermove", {
      clientX: centre.x,
      clientY: rect.top - 500,
    });

    expect(reader.value("move-up")).toBe(1);
  });

  it("returns all four actions to rest when the thumb lifts", () => {
    const { multi, reader } = rig("single-stick", ["move-up", "move-right"]);
    touch(document);
    const stick = multi("move-up");
    pin(stick, rect);
    pointer(stick, "pointerdown", {
      clientX: centre.x + half * 0.7,
      clientY: centre.y - half * 0.7,
    });
    expect(reader.value("move-up")).toBeGreaterThan(0);
    expect(reader.value("move-right")).toBeGreaterThan(0);

    pointer(stick, "pointerup", {
      clientX: centre.x + half * 0.7,
      clientY: centre.y - half * 0.7,
    });

    for (const action of ["move-up", "move-down", "move-left", "move-right"]) {
      expect(reader.value(action), action).toBe(0);
    }
  });

  it("drives each stick's own actions on dual-stick", () => {
    const { multi, reader } = rig("dual-stick", ["move-up", "look-left"]);
    touch(document);
    const move = multi("move-up");
    const look = multi("look-up");
    pin(move, rect);
    pin(look, { ...rect, left: 440 });

    pointer(move, "pointerdown", { pointerId: 1, ...up(1) });
    pointer(look, "pointerdown", {
      pointerId: 2,
      clientX: 540 - raw(0.25) * half,
      clientY: centre.y,
    });

    expect(reader.value("move-up")).toBeCloseTo(1);
    expect(reader.value("move-down")).toBe(0);
    expect(reader.value("look-left")).toBeCloseTo(0.25);
    expect(reader.value("look-right")).toBe(0);
    expect(reader.value("look-up")).toBe(0);
  });

  it("places its knob where the thumb is", () => {
    const { multi } = rig("single-stick", ["move-up", "move-right"]);
    touch(document);
    const stick = multi("move-up");
    pin(stick, rect);

    pointer(stick, "pointerdown", up(1));
    expect(stick.style.getPropertyValue("--stick-y")).toBe("1");
    expect(stick.style.getPropertyValue("--stick-x")).toBe("0");

    pointer(stick, "pointerup", up(1));
    expect(stick.style.getPropertyValue("--stick-y")).toBe("");
  });
});

describe("a pad", () => {
  const rect = { left: 0, top: 0, width: 200, height: 200 };

  it.each([
    ["up", 100, 20, ["up"]],
    ["down", 100, 180, ["down"]],
    ["left", 20, 100, ["left"]],
    ["right", 180, 100, ["right"]],
    ["up-right", 170, 30, ["up", "right"]],
    ["up-left", 30, 30, ["up", "left"]],
    ["down-left", 30, 170, ["down", "left"]],
    ["down-right", 170, 170, ["down", "right"]],
  ])("resolves %s", (_, x, y, engaged) => {
    const { multi, reader } = rig("dpad-4");
    touch(document);
    const pad = multi("up");
    pin(pad, rect);

    pointer(pad, "pointerdown", { clientX: x, clientY: y });

    for (const action of ["up", "down", "left", "right"]) {
      expect(reader.value(action), action).toBe(
        engaged.includes(action) ? 1 : 0,
      );
    }
  });

  it("reads its centre as rest and releases every direction on lift", () => {
    const { multi, reader } = rig("dpad-4");
    touch(document);
    const pad = multi("up");
    pin(pad, rect);

    pointer(pad, "pointerdown", { clientX: 170, clientY: 30 });
    pointer(pad, "pointermove", { clientX: 100, clientY: 100 });
    expect(reader.value("up")).toBe(0);
    expect(reader.value("right")).toBe(0);

    pointer(pad, "pointermove", { clientX: 100, clientY: 20 });
    expect(reader.value("up")).toBe(1);

    pointer(pad, "pointerup", { clientX: 100, clientY: 20 });
    expect(reader.value("up")).toBe(0);
  });

  it("hands an analog direction its axis magnitude", () => {
    const { multi, reader } = rig("dpad-4", ["up", "right"]);
    touch(document);
    const pad = multi("up");
    pin(pad, rect);

    // Straight up, 60 of the 100 half-height above centre: raw 0.6.
    pointer(pad, "pointerdown", { clientX: 100, clientY: 40 });

    expect(reader.value("up")).toBeCloseTo((0.6 - DEAD_ZONE) / (1 - DEAD_ZONE));
    expect(reader.value("right")).toBe(0);
  });
});

describe("isolation from the game's pointer", () => {
  it("keeps a contact on a control out of the pointer's contacts and samples", () => {
    const { control, input, reader } = rig("single-stick");
    touch(document, { pointerId: 1, clientX: 5, clientY: 5 });
    pointer(document, "pointerup", { pointerId: 1, clientX: 5, clientY: 5 });
    input.endFrame();

    pointer(control("confirm"), "pointerdown", {
      pointerId: 2,
      pointerType: "touch",
      clientX: 300,
      clientY: 20,
    });
    pointer(control("confirm"), "pointermove", {
      pointerId: 2,
      pointerType: "touch",
      clientX: 305,
      clientY: 22,
    });
    pointer(control("confirm"), "pointerup", {
      pointerId: 2,
      pointerType: "touch",
      clientX: 305,
      clientY: 22,
    });

    expect(reader.pointerContacts()).toEqual([]);
    expect(reader.pointerSamples()).toEqual([]);
    expect(reader.pointer()).toMatchObject({ x: 5, y: 5, down: false });
  });

  it("stops every one of the four pointer events at the control", () => {
    const { control } = rig("single-stick");
    touch(document);
    const reached: string[] = [];
    const listener = (event: Event): void => {
      reached.push(event.type);
    };
    for (const type of [
      "pointerdown",
      "pointermove",
      "pointerup",
      "pointercancel",
    ]) {
      document.addEventListener(type, listener);
    }

    pointer(control("confirm"), "pointerdown", { pointerId: 1 });
    pointer(control("confirm"), "pointermove", { pointerId: 1 });
    pointer(control("confirm"), "pointercancel", { pointerId: 1 });
    pointer(control("confirm"), "pointerup", { pointerId: 9 });

    expect(reached).toEqual([]);
    for (const type of [
      "pointerdown",
      "pointermove",
      "pointerup",
      "pointercancel",
    ]) {
      document.removeEventListener(type, listener);
    }
  });

  it("does not let a mouse on a control hide the controls", () => {
    const { control, container } = rig("single-stick");
    touch(document);

    pointer(control("confirm"), "pointerdown", { pointerType: "mouse" });

    expect(hidden(container)).toBe(false);
  });

  it("captures the pointer on the control and releases it on lift", () => {
    const { control } = rig("single-stick");
    touch(document);
    const button = control("confirm");
    const capture = vi.fn();
    const release = vi.fn();
    button.setPointerCapture = capture;
    button.releasePointerCapture = release;

    pointer(button, "pointerdown", { pointerId: 4 });
    expect(capture).toHaveBeenCalledWith(4);

    pointer(button, "pointerup", { pointerId: 4 });
    expect(release).toHaveBeenCalledWith(4);
  });

  it("survives a capture the host refuses", () => {
    const { control, reader } = rig("single-stick");
    touch(document);
    const button = control("confirm");
    button.setPointerCapture = (): void => {
      throw new Error("InvalidStateError");
    };

    expect(() =>
      pointer(button, "pointerdown", { pointerId: 4 }),
    ).not.toThrow();
    expect(reader.value("confirm")).toBe(1);
  });

  it("takes the default action of a pointerdown, so no compatibility mouse event follows", () => {
    const { control } = rig("single-stick");
    touch(document);

    const event = pointer(control("confirm"), "pointerdown");

    expect(event.defaultPrevented).toBe(true);
  });
});

describe("hiding while held", () => {
  it("returns a held action to rest when a keyboard hides the controls", () => {
    const { control, reader } = rig("single-stick");
    touch(document);
    pointer(control("confirm"), "pointerdown", { pointerId: 1 });
    expect(reader.value("confirm")).toBe(1);

    keyDown(document);

    expect(reader.value("confirm")).toBe(0);
  });
});

describe("without a document", () => {
  it("is inert over a bare event target: nothing drawn, nothing listened to, null", () => {
    const target = new EventTarget();
    const added = vi.spyOn(target, "addEventListener");
    const surface = surfaceOver(target);
    const input = new InputSystem({
      surface,
      viewport: () => VIEWPORT,
      layout: "dpad-4",
    });
    const listenersBefore = added.mock.calls.length;
    const emitted: Emitted[] = [];
    const layout = TOUCH_LAYOUTS["dpad-4"];
    if (layout === undefined) throw new Error("no dpad-4");
    const controls = new TouchControls({
      surface,
      actions: input,
      layout,
      emit: (event, payload) => {
        emitted.push({ event, payload } as Emitted);
      },
    });

    expect(controls.state()).toBeNull();
    expect(document.querySelector(`[${CONTAINER_ATTRIBUTE}]`)).toBeNull();
    expect(document.querySelector("style")).toBeNull();
    // Only the input system's own listeners went on.
    expect(added.mock.calls.length).toBe(listenersBefore);

    touch(target);
    expect(controls.state()).toBeNull();
    expect(emitted).toEqual([]);
    expect(() => controls.detach()).not.toThrow();
    input.detach();
  });

  it("finds the document through a node other than the document itself", () => {
    const canvas = document.createElement("canvas");
    document.body.append(canvas);
    const surface = surfaceOver(canvas);
    const input = new InputSystem({ surface, viewport: () => VIEWPORT });
    const layout = TOUCH_LAYOUTS["dpad-4"];
    if (layout === undefined) throw new Error("no dpad-4");
    const controls = new TouchControls({
      surface,
      actions: input,
      layout,
      emit: () => undefined,
    });

    expect(controls.state()).toEqual({ layout: "dpad-4", visible: false });
    expect(document.querySelector(`[${CONTAINER_ATTRIBUTE}]`)).not.toBeNull();
    controls.detach();
    input.detach();
  });
});

describe("detach", () => {
  it("removes the overlay and its stylesheet", () => {
    const { controls } = rig("dpad-4-two-buttons");

    controls.detach();

    expect(document.querySelector(`[${CONTAINER_ATTRIBUTE}]`)).toBeNull();
    expect(document.querySelector("style")).toBeNull();
  });

  it("stops listening, so a later touch shows nothing and says nothing", () => {
    const { controls, emitted } = rig("dpad-4-two-buttons");
    const removed = vi.spyOn(document, "removeEventListener");

    controls.detach();
    touch(document);
    keyDown(document);

    expect(emitted).toEqual([]);
    expect(controls.state()?.visible).toBe(false);
    expect(removed.mock.calls.map((call) => call[0]).sort()).toEqual([
      "keydown",
      "pointerdown",
      "pointermove",
    ]);
  });

  it("returns a held action to rest on the way out", () => {
    const { controls, control, reader } = rig("dpad-4-two-buttons");
    touch(document);
    pointer(control("a"), "pointerdown", { pointerId: 1 });
    expect(reader.value("a")).toBe(1);

    controls.detach();

    expect(reader.value("a")).toBe(0);
  });

  it("is idempotent, because teardown races", () => {
    const { controls } = rig("dpad-4");

    controls.detach();

    expect(() => controls.detach()).not.toThrow();
  });
});

describe("the geometry", () => {
  it("deflects toward the start of the axis, clamped, past a dead zone", () => {
    expect(axisDeflection(50, 0, 100)).toBe(0);
    expect(axisDeflection(0, 0, 100)).toBe(1);
    expect(axisDeflection(100, 0, 100)).toBe(-1);
    expect(axisDeflection(-40, 0, 100)).toBe(1);
    expect(axisDeflection(50 - 50 * DEAD_ZONE + 1, 0, 100)).toBe(0);
    expect(axisDeflection(25, 0, 100)).toBeCloseTo(
      (0.5 - DEAD_ZONE) / (1 - DEAD_ZONE),
    );
  });

  it("reads a rect with no extent, or a contact with no position, as rest", () => {
    expect(axisDeflection(10, 0, 0)).toBe(0);
    expect(axisDeflection(Number.NaN, 0, 100)).toBe(0);
  });

  it("reads a stick as a point in the unit disc, dead about the centre, clamped at the rim", () => {
    const rect = { left: 0, top: 0, width: 100, height: 100 };
    expect(stickDeflection(rect, { x: 50, y: 50 })).toEqual({ x: 0, y: 0 });
    expect(stickDeflection(rect, { x: 50, y: 0 })).toEqual({ x: 0, y: 1 });
    expect(stickDeflection(rect, { x: 100, y: 50 })).toEqual({ x: 1, y: 0 });
    expect(stickDeflection(rect, { x: 50, y: 100 })).toEqual({ x: 0, y: -1 });
    expect(stickDeflection(rect, { x: 0, y: 50 })).toEqual({ x: -1, y: 0 });
    // Inside the dead zone on the diagonal, though each axis alone is past it.
    expect(stickDeflection(rect, { x: 50 + 3, y: 50 - 3 })).toEqual({
      x: 0,
      y: 0,
    });
    // Past the rim on the diagonal: a unit vector, not (1, 1).
    const corner = stickDeflection(rect, { x: 100, y: 0 });
    expect(Math.hypot(corner.x, corner.y)).toBeCloseTo(1);
    expect(corner.x).toBeCloseTo(Math.SQRT1_2);
    expect(corner.y).toBeCloseTo(Math.SQRT1_2);
    // Half way up: the rescaled magnitude.
    expect(stickDeflection(rect, { x: 50, y: 25 }).y).toBeCloseTo(
      (0.5 - DEAD_ZONE) / (1 - DEAD_ZONE),
    );
  });

  it("reads a stick over a rect with no extent, or a contact with no position, as rest", () => {
    const rect = { left: 0, top: 0, width: 100, height: 100 };
    expect(stickDeflection({ ...rect, width: 0 }, { x: 10, y: 10 })).toEqual({
      x: 0,
      y: 0,
    });
    expect(stickDeflection(rect, { x: Number.NaN, y: 10 })).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("resolves a pad's eight ways from its two axes", () => {
    const rect = { left: 0, top: 0, width: 100, height: 100 };
    expect(padDirections(rect, { x: 50, y: 50 })).toEqual({
      up: 0,
      down: 0,
      left: 0,
      right: 0,
    });
    expect(padDirections(rect, { x: 50, y: 0 })).toMatchObject({
      up: 1,
      down: 0,
      left: 0,
      right: 0,
    });
    expect(padDirections(rect, { x: 100, y: 0 })).toMatchObject({
      up: 1,
      right: 1,
      down: 0,
      left: 0,
    });
    expect(padDirections(rect, { x: 0, y: 100 })).toMatchObject({
      down: 1,
      left: 1,
      up: 0,
      right: 0,
    });
  });
});
