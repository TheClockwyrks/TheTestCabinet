/**
 * The on-screen touch controls: what a touchscreen player is given for the
 * selected layout, and the engine's one place that draws chrome for input.
 *
 * A layout names a control scheme and the actions it drives, and a build on a
 * phone is playable only if something on the screen drives those actions. This
 * module draws that something. It is a DOM overlay rather than part of the
 * canvas, for three reasons that each rule the canvas out on their own:
 *
 * - The canvas is the game's own picture. The draw-command recorder and a
 *   captured frame hold what the build drew, and a set of buttons baked into it
 *   would misreport that.
 * - A contact on a control has to be told apart from a contact on the game, and
 *   the element that received the event is what tells them apart. On a canvas
 *   every contact is a contact on the game, and the engine would be hit-testing
 *   its own chrome against the pointer module's every event.
 * - The browser's own gesture handling is per element. A control declines the
 *   browser's touch gestures and text selection with two properties; a region of
 *   a canvas cannot.
 *
 * The controls drive the actions through the same seam a key does —
 * {@link ActionDriver.setAction}, which is `InputRegistry.setAction` — so the game
 * reads one number whichever source moved it: an analog action receives the
 * partial magnitude a slider gives, a digital one quantizes it, and each crossing
 * from rest arms the edge `pressed` reports exactly as a keypress would.
 *
 * **Appearance.** The controls are hidden at construction and shown by the first
 * `pointerdown` whose `pointerType` is `"touch"`. A `keydown`, or a `pointerdown`
 * or `pointermove` from a mouse or a pen, hides them again, and the next touch
 * shows them, so a device carrying both a touchscreen and a keyboard shows them
 * exactly while the screen is in use. Those listeners go on the same target the
 * key and pointer listeners use ({@link SurfaceMetrics.events}), so a caller that
 * dispatches events into a target of its own reaches them by the path a player
 * does. Only pointer and key events are read, never `mousedown` or `touchstart`:
 * a browser does not synthesize a `pointerdown` with `pointerType: "mouse"` from
 * a touch, so the compatibility mouse events cannot hide the controls by mistake.
 *
 * **Isolation.** A contact on a control belongs to the control. Its `pointerdown`,
 * `pointermove`, `pointerup`, and `pointercancel` stop propagating at the control,
 * so they never reach the pointer module listening on the document, and the
 * control captures the pointer so a thumb that slides off keeps driving until it
 * lifts. The touch that first reveals the controls lands on the game, not on a
 * control, and reaches the pointer as any other.
 *
 * **No document, no controls.** An engine built over a surface whose event target
 * has no document behind it — the headless case — has nowhere to put an overlay.
 * The class is then inert: it draws nothing, listens to nothing, and reports
 * `null`, and the engine keeps working exactly as it did.
 *
 * This module depends on the surface, the one method of the registry it drives,
 * the layout, and an emit function, and on nothing else in the engine. It is the
 * reference the other engines' controls are ported from, so what a control *is*
 * is kept in the pure functions at the bottom of the file, and what it *does to
 * the DOM* in the class above them.
 */

import type {
  EngineEventMap,
  SurfaceMetrics,
  TouchControlsState,
  TouchLayout,
} from "./contract";
import { MENU_ACTIONS } from "./layouts";

/** The one thing the controls need of the action registry. */
export interface ActionDriver {
  /** Drive `name` to `value`, through the same resolution a key goes through. */
  setAction(name: string, value: number): void;
}

/** What the controls are built from. */
export interface TouchControlsOptions {
  /** The surface whose event target the visibility listeners go on. */
  surface: SurfaceMetrics;
  /** Where a control's value goes. */
  actions: ActionDriver;
  /** The selected layout, whose controls are drawn. */
  layout: TouchLayout;
  /** The engine's event broadcaster. */
  emit: <K extends keyof EngineEventMap>(
    event: K,
    payload: EngineEventMap[K],
  ) => void;
}

/** Why the controls were hidden, as `touch-controls:hidden` reports it. */
type HideReason = EngineEventMap["touch-controls:hidden"]["reason"];

/**
 * The attribute the container carries, valued with the layout's name, and the
 * prefix the control attributes share.
 *
 * The names carry no engine-specific prefix because the engine's own container
 * scopes them: a driver or a check finds the container first and the controls
 * inside it, so the names need only be unique within the overlay.
 */
export const CONTAINER_ATTRIBUTE = "data-touch-controls";
/** The attribute naming the action a control drives (the first, on a slider or a pad). */
export const ACTION_ATTRIBUTE = "data-action";
/** The attribute listing every action a slider or a pad drives, space-separated. */
export const ACTIONS_ATTRIBUTE = "data-actions";
/** The attribute a control carries while a pointer holds it. */
const HELD_ATTRIBUTE = "data-held";
/** The attribute the injected stylesheet carries, so teardown finds its own. */
const STYLE_ATTRIBUTE = "data-touch-controls-style";

/**
 * The fraction of a slider's or a pad's half-extent inside which a contact reads
 * as rest.
 *
 * A thumb that lands on a slider lands near its middle, and without a dead zone
 * the first contact would drive the action by whatever few pixels it missed the
 * centre by. Past the zone the deflection is rescaled to reach `1` at the edge,
 * so the zone costs no range.
 */
export const DEAD_ZONE = 0.15;

/**
 * The magnitudes one contact gives a control's actions, by action name.
 *
 * A slider gives one of its pair the deflection and the other `0`; a pad gives
 * the engaged directions their axis magnitudes; a button gives its action `1`.
 */
export type Contribution = Readonly<Record<string, number>>;

/** A control as it is described before it is built. */
type ControlSpec =
  | { kind: "button"; action: string; label: string; classes: string[] }
  | { kind: "slider"; positive: string; negative: string; classes: string[] }
  | {
      kind: "pad";
      up: string;
      down: string;
      left: string;
      right: string;
      classes: string[];
    };

/** Where the menu strip goes for a layout. */
type MenuPlacement = "centre" | "right";

/**
 * A control as it is held once built: its element, what it drives, and the
 * pointer holding it, if one is.
 */
interface Control {
  readonly spec: ControlSpec;
  readonly element: HTMLElement;
  /** Every action the control can drive, in `data-actions` order. */
  readonly actions: readonly string[];
  /** The id of the pointer holding the control, or `null` at rest. */
  pointer: number | null;
  /** The listeners on the element, so `detach` removes exactly what was added. */
  readonly listeners: [string, (event: Event) => void][];
}

export class TouchControls {
  readonly #layout: TouchLayout;
  readonly #actions: ActionDriver;
  readonly #emit: TouchControlsOptions["emit"];
  /** The target the visibility listeners went on, taken once (see `InputRegistry`). */
  readonly #target: EventTarget;
  /** The overlay, or `null` when there was no document to place one in. */
  readonly #container: HTMLElement | null;
  readonly #style: HTMLStyleElement | null;
  readonly #controls: Control[] = [];
  /**
   * What each control is currently giving each action, so two controls that
   * drive one action — the menu's `confirm` and the thumb's — resolve to the
   * larger of the two rather than the last one to speak. Releasing one while
   * the other is held leaves the action held.
   */
  readonly #contributions = new Map<string, Map<Control, number>>();
  /** The value each action was last driven to, so an unchanged value is not re-sent. */
  readonly #driven = new Map<string, number>();
  #visible = false;
  #detached = false;

  /** A touch shows the controls; a mouse or a pen hides them. */
  readonly #onPointerDown = (event: Event): void => {
    const device = pointerDevice(event);
    if (device === "touch") this.#show();
    else this.#hide(device);
  };

  /** A mouse or pen moving hides them; a touch moving changes nothing. */
  readonly #onPointerMove = (event: Event): void => {
    const device = pointerDevice(event);
    if (device !== "touch") this.#hide(device);
  };

  readonly #onKeyDown = (): void => {
    this.#hide("keyboard");
  };

  /** A long press on a control must not open the browser's context menu over it. */
  readonly #onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  /**
   * Builds the overlay for `layout` in the document behind the surface's event
   * target, hidden, and attaches the visibility listeners to that target.
   *
   * Built at construction rather than at first touch so the elements a driver
   * finds by their markers exist from the moment the engine does, hidden or not,
   * and so the first touch has nothing to build and shows the controls at once.
   */
  constructor(options: TouchControlsOptions) {
    this.#layout = options.layout;
    this.#actions = options.actions;
    this.#emit = options.emit;
    this.#target = options.surface.events();

    const document = owningDocument(this.#target);
    const host = document?.body ?? document?.documentElement ?? null;
    if (document === null || host === null) {
      this.#container = null;
      this.#style = null;
      return;
    }

    this.#style = document.createElement("style");
    this.#style.setAttribute(STYLE_ATTRIBUTE, "");
    this.#style.textContent = STYLESHEET;
    (document.head ?? host).append(this.#style);

    this.#container = document.createElement("div");
    this.#container.setAttribute(CONTAINER_ATTRIBUTE, this.#layout.name);
    this.#container.hidden = true;
    this.#container.style.display = "none";
    this.#container.addEventListener("contextmenu", this.#onContextMenu);

    const frame = document.createElement("div");
    frame.className = "frame";
    this.#container.append(frame);

    const { menu, controls } = layoutControls(this.#layout);
    for (const spec of controls) frame.append(this.#build(document, spec));
    const strip = document.createElement("div");
    strip.className = `menu menu-${menu}`;
    for (const action of MENU_ACTIONS) {
      strip.append(
        this.#build(document, {
          kind: "button",
          action,
          label: capitalize(action),
          classes: ["menu-button"],
        }),
      );
    }
    frame.append(strip);
    host.append(this.#container);

    this.#target.addEventListener("pointerdown", this.#onPointerDown);
    this.#target.addEventListener("pointermove", this.#onPointerMove);
    this.#target.addEventListener("keydown", this.#onKeyDown);
  }

  /**
   * The layout and whether its controls are showing, as a fresh copy, or `null`
   * when there was no document to draw them in.
   */
  state(): TouchControlsState | null {
    if (this.#container === null) return null;
    return { layout: this.#layout.name, visible: this.#visible };
  }

  /**
   * Releases every held control, removes the overlay and its stylesheet, and
   * detaches the visibility listeners. Idempotent, because teardown races.
   *
   * The controls are released before anything is removed, so an action a thumb
   * was holding when the engine went away is driven back to rest rather than
   * left reading held.
   */
  detach(): void {
    if (this.#detached) return;
    this.#detached = true;
    for (const control of this.#controls) {
      this.#release(control);
      for (const [type, listener] of control.listeners) {
        control.element.removeEventListener(type, listener);
      }
    }
    if (this.#container !== null) {
      this.#target.removeEventListener("pointerdown", this.#onPointerDown);
      this.#target.removeEventListener("pointermove", this.#onPointerMove);
      this.#target.removeEventListener("keydown", this.#onKeyDown);
      this.#container.removeEventListener("contextmenu", this.#onContextMenu);
      this.#container.remove();
    }
    this.#style?.remove();
  }

  #show(): void {
    if (this.#visible || this.#container === null || this.#detached) return;
    this.#visible = true;
    this.#container.hidden = false;
    this.#container.style.display = "";
    this.#emit("touch-controls:shown", { layout: this.#layout.name });
  }

  /**
   * Hides the controls and releases whatever they were holding: a control that
   * cannot be seen must not keep driving an action, and the pointer holding it
   * has no visible thing to lift off.
   */
  #hide(reason: HideReason): void {
    if (!this.#visible || this.#container === null) return;
    this.#visible = false;
    for (const control of this.#controls) this.#release(control);
    this.#container.hidden = true;
    this.#container.style.display = "none";
    this.#emit("touch-controls:hidden", { layout: this.#layout.name, reason });
  }

  /**
   * Builds one control's element, marks it, and attaches the pointer listeners
   * that isolate it from the game and drive its actions.
   *
   * The four listeners stop propagation unconditionally, whether or not the
   * control ends up acting on the event: a contact on a control is the control's
   * whatever it does with it, and a `pointermove` from a mouse hovering a visible
   * control is likewise not a report the game's pointer should receive.
   */
  #build(document: Document, spec: ControlSpec): HTMLElement {
    const element = document.createElement("div");
    const actions = specActions(spec);
    element.className = ["control", spec.kind, ...spec.classes].join(" ");
    element.setAttribute("role", "button");
    element.setAttribute("aria-label", actions.join(" "));
    element.setAttribute(ACTION_ATTRIBUTE, actions[0] ?? "");
    if (spec.kind !== "button") {
      element.setAttribute(ACTIONS_ATTRIBUTE, actions.join(" "));
    }
    decorate(document, element, spec);

    const control: Control = {
      spec,
      element,
      actions,
      pointer: null,
      listeners: [],
    };

    const onDown = (event: Event): void => {
      event.stopPropagation();
      // No focus change, no text selection, and no compatibility mouse events
      // synthesized for this contact: the control has already taken it.
      event.preventDefault();
      // A second finger on a held control changes nothing; the first keeps it.
      if (control.pointer !== null) return;
      control.pointer = pointerId(event);
      capturePointer(element, control.pointer);
      element.setAttribute(HELD_ATTRIBUTE, "");
      this.#engage(control, event);
    };
    const onMove = (event: Event): void => {
      event.stopPropagation();
      if (control.pointer === null || control.pointer !== pointerId(event)) {
        return;
      }
      this.#engage(control, event);
    };
    const onEnd = (event: Event): void => {
      event.stopPropagation();
      if (control.pointer === null || control.pointer !== pointerId(event)) {
        return;
      }
      this.#release(control);
    };
    control.listeners.push(
      ["pointerdown", onDown],
      ["pointermove", onMove],
      ["pointerup", onEnd],
      ["pointercancel", onEnd],
    );
    for (const [type, listener] of control.listeners) {
      element.addEventListener(type, listener);
    }
    this.#controls.push(control);
    return element;
  }

  /** Reads the contact against the control's rect and drives what it gives. */
  #engage(control: Control, event: Event): void {
    const position = clientPosition(event);
    const rect = control.element.getBoundingClientRect();
    const contribution = contributionOf(control.spec, rect, position);
    if (control.spec.kind === "slider") {
      const deflection =
        (contribution[control.spec.positive] ?? 0) -
        (contribution[control.spec.negative] ?? 0);
      control.element.style.setProperty("--deflection", String(deflection));
    }
    this.#drive(control, contribution);
  }

  /** Returns every action the control holds to rest and lets the pointer go. */
  #release(control: Control): void {
    const held = control.pointer;
    control.pointer = null;
    control.element.removeAttribute(HELD_ATTRIBUTE);
    control.element.style.removeProperty("--deflection");
    if (held !== null) releasePointerCapture(control.element, held);
    this.#drive(control, {});
  }

  /**
   * Records what `control` now gives each of its actions and drives each to the
   * largest value any control gives it.
   *
   * An action's value is sent only when it changed. The registry would accept a
   * repeat harmlessly, but a `pointermove` arrives many times a frame and the
   * one call that matters is the one that moved the number.
   */
  #drive(control: Control, contribution: Contribution): void {
    for (const action of control.actions) {
      let byControl = this.#contributions.get(action);
      if (byControl === undefined) {
        byControl = new Map();
        this.#contributions.set(action, byControl);
      }
      const value = contribution[action] ?? 0;
      if (value === 0) byControl.delete(control);
      else byControl.set(control, value);

      let resolved = 0;
      for (const given of byControl.values())
        resolved = Math.max(resolved, given);
      if (this.#driven.get(action) === resolved) continue;
      this.#driven.set(action, resolved);
      this.#actions.setAction(action, resolved);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* The geometry: what a contact on a control means                            */
/* -------------------------------------------------------------------------- */

/** A rect's extent along one axis, as `getBoundingClientRect` reports it. */
export interface Extent {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** A client-space point. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * A contact's deflection in `[-1, 1]` along one axis of `rect`, positive toward
 * `start`, with the dead zone applied and the remaining travel rescaled to reach
 * `1` at the edge.
 *
 * `0` for a rect with no extent: an element that has not been laid out gives a
 * contact no place to be measured against, so it reads as rest rather than as a
 * division by zero.
 */
export function axisDeflection(
  contact: number,
  start: number,
  extent: number,
): number {
  if (!(extent > 0) || !Number.isFinite(contact)) return 0;
  const half = extent / 2;
  const raw = (start + half - contact) / half;
  const clamped = Math.max(-1, Math.min(1, raw));
  const magnitude = Math.abs(clamped);
  if (magnitude < DEAD_ZONE) return 0;
  const rescaled = (magnitude - DEAD_ZONE) / (1 - DEAD_ZONE);
  return Math.sign(clamped) * rescaled;
}

/**
 * A vertical slider's deflection: `1` at its top edge, `-1` at its bottom, `0`
 * across the dead zone about its middle.
 */
export function sliderDeflection(rect: Extent, contact: Point): number {
  return axisDeflection(contact.y, rect.top, rect.height);
}

/**
 * What a pad gives its four directions for a contact: eight ways, each engaged
 * direction receiving the deflection along its own axis.
 *
 * The eight ways are the four axes and the four diagonals, each a 45° sector
 * about its heading, so a thumb pushed up-and-right engages `up` and `right`
 * together and one pushed almost straight up engages `up` alone. Inside the dead
 * zone nothing is engaged.
 */
export function padDirections(
  rect: Extent,
  contact: Point,
): { up: number; down: number; left: number; right: number } {
  const rest = { up: 0, down: 0, left: 0, right: 0 };
  // Positive `x` is rightward, so the horizontal axis runs from the right edge.
  const x = -axisDeflection(contact.x, rect.left, rect.width);
  const y = axisDeflection(contact.y, rect.top, rect.height);
  if (x === 0 && y === 0) return rest;
  // Sector 0 is right, then counter-clockwise by 45°: 2 is up, 4 is left, 6 down.
  const sector = Math.round(Math.atan2(y, x) / (Math.PI / 4)) & 7;
  const vertical =
    sector >= 1 && sector <= 3 ? "up" : sector >= 5 ? "down" : null;
  const horizontal =
    sector === 7 || sector <= 1
      ? "right"
      : sector >= 3 && sector <= 5
        ? "left"
        : null;
  return {
    ...rest,
    ...(vertical === null ? {} : { [vertical]: Math.abs(y) }),
    ...(horizontal === null ? {} : { [horizontal]: Math.abs(x) }),
  };
}

/** What one contact on a control of `spec` gives each of the control's actions. */
export function contributionOf(
  spec: ControlSpec,
  rect: Extent,
  contact: Point,
): Contribution {
  switch (spec.kind) {
    case "button":
      return { [spec.action]: 1 };
    case "slider": {
      const deflection = sliderDeflection(rect, contact);
      return {
        [spec.positive]: Math.max(0, deflection),
        [spec.negative]: Math.max(0, -deflection),
      };
    }
    case "pad": {
      const directions = padDirections(rect, contact);
      return {
        [spec.up]: directions.up,
        [spec.down]: directions.down,
        [spec.left]: directions.left,
        [spec.right]: directions.right,
      };
    }
  }
}

/* -------------------------------------------------------------------------- */
/* The catalogue's drawings                                                   */
/* -------------------------------------------------------------------------- */

/**
 * What each layout draws, beside the menu strip every layout carries.
 *
 * Keyed by the layout's name rather than derived from its vocabulary, because
 * the vocabulary says which actions exist and not where a thumb finds them. A
 * layout the catalogue holds and this table does not is refused, so adding a
 * layout to one without the other fails at construction rather than drawing an
 * empty overlay.
 */
const DRAWINGS: Readonly<
  Record<string, { menu: MenuPlacement; controls: ControlSpec[] }>
> = {
  "dual-vertical": {
    menu: "centre",
    controls: [
      {
        kind: "slider",
        positive: "p1-up",
        negative: "p1-down",
        classes: ["left"],
      },
      {
        kind: "slider",
        positive: "p2-up",
        negative: "p2-down",
        classes: ["right"],
      },
    ],
  },
  "single-vertical": {
    menu: "centre",
    controls: [
      { kind: "slider", positive: "up", negative: "down", classes: ["right"] },
    ],
  },
  "dpad-4": {
    menu: "right",
    controls: [
      {
        kind: "pad",
        up: "up",
        down: "down",
        left: "left",
        right: "right",
        classes: [],
      },
      {
        kind: "button",
        action: "confirm",
        label: "OK",
        classes: ["round", "large"],
      },
    ],
  },
  "dpad-4-two-buttons": {
    menu: "right",
    controls: [
      {
        kind: "pad",
        up: "up",
        down: "down",
        left: "left",
        right: "right",
        classes: [],
      },
      { kind: "button", action: "a", label: "A", classes: ["round", "a"] },
      { kind: "button", action: "b", label: "B", classes: ["round", "b"] },
      {
        kind: "button",
        action: "confirm",
        label: "OK",
        classes: ["round", "small"],
      },
    ],
  },
};

/**
 * The drawing for `layout`.
 *
 * @throws for a layout with no drawing, naming it: the catalogue and this table
 * must agree, and a layout that can be selected but not drawn is a build that
 * runs and shows a phone nothing.
 */
export function layoutControls(layout: TouchLayout): {
  menu: MenuPlacement;
  controls: ControlSpec[];
} {
  const drawing = DRAWINGS[layout.name];
  if (drawing === undefined) {
    throw new Error(
      `Touch layout "${layout.name}" has no on-screen controls to draw.`,
    );
  }
  return drawing;
}

/** Every action a control of `spec` drives, in the order `data-actions` lists them. */
function specActions(spec: ControlSpec): string[] {
  switch (spec.kind) {
    case "button":
      return [spec.action];
    case "slider":
      return [spec.positive, spec.negative];
    case "pad":
      return [spec.up, spec.down, spec.left, spec.right];
  }
}

/** Fills a control's element with what a player sees on it. */
function decorate(
  document: Document,
  element: HTMLElement,
  spec: ControlSpec,
): void {
  switch (spec.kind) {
    case "button":
      element.textContent = spec.label;
      return;
    case "slider": {
      for (const [className, glyph] of [
        ["cap", "▲"],
        ["thumb", ""],
        ["cap", "▼"],
      ] as const) {
        const part = document.createElement("span");
        part.className = className;
        part.textContent = glyph;
        element.append(part);
      }
      return;
    }
    case "pad": {
      for (const [className, glyph] of [
        ["arrow up", "▲"],
        ["arrow left", "◀"],
        ["arrow right", "▶"],
        ["arrow down", "▼"],
      ] as const) {
        const arrow = document.createElement("span");
        arrow.className = className;
        arrow.textContent = glyph;
        element.append(arrow);
      }
      return;
    }
  }
}

/** `confirm` → `Confirm`, for a menu button's label. */
function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/* -------------------------------------------------------------------------- */
/* The DOM seams                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The document behind an event target, or `null` when there is none.
 *
 * Structural rather than `instanceof`, like every other narrowing in this
 * package: the target may come from another realm. A document is its own
 * document, a node has an owner, a window has a document, and a bare
 * `EventTarget` — what a headless caller supplies — has nothing, which is the
 * case that makes the controls inert.
 */
function owningDocument(target: EventTarget): Document | null {
  const node = target as Partial<Node>;
  if (node.nodeType === 9) return target as Document;
  if (typeof node.nodeType === "number") return node.ownerDocument ?? null;
  const window = target as Partial<Window>;
  const document = window.document as Partial<Node> | undefined;
  if (document?.nodeType === 9) return document as Document;
  return null;
}

/** The device behind a pointer event, defaulting to a mouse as the pointer module does. */
function pointerDevice(event: Event): "touch" | "mouse" | "pen" {
  const type = (event as Partial<PointerEvent>).pointerType;
  return type === "touch" || type === "pen" ? type : "mouse";
}

/** The pointer's id, `0` for an event that carries none (see the pointer module). */
function pointerId(event: Event): number {
  const id = (event as Partial<PointerEvent>).pointerId;
  return typeof id === "number" ? id : 0;
}

/**
 * The event's client position, or `NaN` on an axis the event does not report,
 * which a slider or a pad reads as rest along that axis. A button reads no
 * position at all, so a hand-dispatched `pointerdown` with none still presses it.
 */
function clientPosition(event: Event): Point {
  const candidate = event as Partial<MouseEvent>;
  return {
    x: typeof candidate.clientX === "number" ? candidate.clientX : Number.NaN,
    y: typeof candidate.clientY === "number" ? candidate.clientY : Number.NaN,
  };
}

/**
 * Captures the pointer on the control, when the host can.
 *
 * Guarded twice: a host without `setPointerCapture` at all (jsdom), and a
 * capture on a pointer that has already ended, which throws.
 */
function capturePointer(element: HTMLElement, id: number): void {
  if (typeof element.setPointerCapture !== "function") return;
  try {
    element.setPointerCapture(id);
  } catch {
    // The pointer is already gone; there is nothing to route.
  }
}

/** Ends the capture, when there is one to end. */
function releasePointerCapture(element: HTMLElement, id: number): void {
  if (typeof element.releasePointerCapture !== "function") return;
  try {
    element.releasePointerCapture(id);
  } catch {
    // Already released, by the browser or by the pointer ending.
  }
}

/* -------------------------------------------------------------------------- */
/* The stylesheet                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The overlay's whole style, injected once per engine and scoped by the
 * container attribute so nothing here reaches the page around the canvas.
 *
 * The container covers the viewport and lets every pointer event through;
 * only the controls take them. Each control declines the browser's touch
 * gestures and text selection, and measures at least 44 CSS pixels on its
 * shortest side; a slider and a pad take about a quarter of the viewport's
 * shorter side. The frame inside the container is inset by the device's
 * safe-area insets, so a control sits clear of a notch or a home indicator.
 */
const STYLESHEET = `
[${CONTAINER_ATTRIBUTE}] {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  pointer-events: none;
  font: 600 14px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #fff;
  -webkit-user-select: none;
  user-select: none;
}
[${CONTAINER_ATTRIBUTE}][hidden] {
  display: none;
}
[${CONTAINER_ATTRIBUTE}] .frame {
  position: absolute;
  inset: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px)
    env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
  pointer-events: none;
}
[${CONTAINER_ATTRIBUTE}] .control {
  position: absolute;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  pointer-events: auto;
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  cursor: pointer;
  background: rgba(0, 0, 0, 0.35);
  border: 2px solid rgba(255, 255, 255, 0.55);
  border-radius: 12px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
}
[${CONTAINER_ATTRIBUTE}] .control[${HELD_ATTRIBUTE}] {
  background: rgba(255, 255, 255, 0.3);
  border-color: rgba(255, 255, 255, 0.9);
}
[${CONTAINER_ATTRIBUTE}] .slider {
  top: 50%;
  width: 64px;
  height: max(44px, 25vmin);
  transform: translateY(-50%);
  flex-direction: column;
  justify-content: space-between;
  padding: 6px 0;
  border-radius: 32px;
}
[${CONTAINER_ATTRIBUTE}] .slider.left { left: 12px; }
[${CONTAINER_ATTRIBUTE}] .slider.right { right: 12px; }
[${CONTAINER_ATTRIBUTE}] .slider .cap {
  font-size: 12px;
  opacity: 0.8;
}
[${CONTAINER_ATTRIBUTE}] .slider .thumb {
  position: absolute;
  left: 50%;
  top: calc(50% - var(--deflection, 0) * (50% - 26px));
  width: 40px;
  height: 40px;
  margin: -20px 0 0 -20px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.75);
}
[${CONTAINER_ATTRIBUTE}] .pad {
  left: 16px;
  bottom: 16px;
  width: max(132px, 25vmin);
  height: max(132px, 25vmin);
  border-radius: 50%;
  display: grid;
  grid-template: 1fr 1fr 1fr / 1fr 1fr 1fr;
  place-items: center;
}
[${CONTAINER_ATTRIBUTE}] .pad .arrow { font-size: 20px; opacity: 0.85; }
[${CONTAINER_ATTRIBUTE}] .pad .arrow.up { grid-area: 1 / 2; }
[${CONTAINER_ATTRIBUTE}] .pad .arrow.left { grid-area: 2 / 1; }
[${CONTAINER_ATTRIBUTE}] .pad .arrow.right { grid-area: 2 / 3; }
[${CONTAINER_ATTRIBUTE}] .pad .arrow.down { grid-area: 3 / 2; }
[${CONTAINER_ATTRIBUTE}] .round {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  font-size: 22px;
}
[${CONTAINER_ATTRIBUTE}] .round.large {
  right: 16px;
  bottom: 16px;
  width: 96px;
  height: 96px;
}
[${CONTAINER_ATTRIBUTE}] .round.a { right: 16px; bottom: 16px; }
[${CONTAINER_ATTRIBUTE}] .round.b { right: 100px; bottom: 76px; }
[${CONTAINER_ATTRIBUTE}] .round.small {
  right: 112px;
  bottom: 8px;
  width: 52px;
  height: 52px;
  font-size: 14px;
}
[${CONTAINER_ATTRIBUTE}] .menu {
  position: absolute;
  top: 8px;
  display: flex;
  gap: 8px;
  pointer-events: none;
}
[${CONTAINER_ATTRIBUTE}] .menu-centre {
  left: 50%;
  transform: translateX(-50%);
}
[${CONTAINER_ATTRIBUTE}] .menu-right { right: 12px; }
[${CONTAINER_ATTRIBUTE}] .menu-button {
  position: relative;
  height: 44px;
  min-width: 64px;
  padding: 0 12px;
  font-size: 13px;
}
`;
