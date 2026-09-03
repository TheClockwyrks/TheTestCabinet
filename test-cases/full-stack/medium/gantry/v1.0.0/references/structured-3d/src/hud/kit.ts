// The vocabulary the readouts are assembled from.
//
// Every readout is a `screen` render component on an actor: a `ShapeComponent`
// for a panel, a `TextComponent` for a line of it, both laid out in the logical
// stage's units from the top-left of the design field (`engine/components.md`).
// This module is the small kit that attaches them and switches them, so a
// screen's actor reads as its layout rather than as a hundred `offset.position`
// assignments.
//
// A group is what a screen switches: components are attached through one, and
// `apply` walks the tree once a frame, so a panel and its lines appear and
// disappear together.

import {
  ShapeComponent,
  TextComponent,
  vec3,
} from "@test-cabinet/structured-3d";
import type { Actor, RenderComponent, Vec3 } from "@test-cabinet/structured-3d";
import { LAYER } from "../layers";
import { display, INK, mono, PANEL, PANEL_EDGE } from "../palette";

/** An axis-aligned rectangle in the logical stage's units. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** How a line of text is set. */
export interface TextSpec {
  readonly size: number;
  readonly weight?: number;
  /** The display face is for headings and figures; everything else is mono. */
  readonly face?: "mono" | "display";
  readonly fill?: string;
  readonly align?: "left" | "center" | "right";
  readonly layer?: number;
}

/**
 * How far below a line's baseline its bottom edge sits, as a fraction of the
 * font size.
 *
 * The engine's `TextComponent` offers `top`, `middle`, and `bottom` baselines
 * and the layouts here are written against the typographic baseline, so a line
 * asked for at `y` is placed with its bottom edge a descender lower. The figure
 * is one descent, near enough for every stack the palette names.
 */
const DESCENT = 0.2;

/** A switchable bag of render components, and the groups nested under it. */
export class HudGroup {
  private readonly parts: RenderComponent[] = [];
  private readonly kids: HudGroup[] = [];

  /** Whether this group draws when its parent does. */
  visible = true;

  constructor(private readonly actor: Actor) {}

  /** A group switched with this one, for a panel that comes and goes. */
  child(): HudGroup {
    const group = new HudGroup(this.actor);
    this.kids.push(group);
    return group;
  }

  /** Attach a component of the game's own, switched with this group. */
  add<C extends RenderComponent>(component: C): C {
    const attached = this.actor.attach(component);
    this.parts.push(attached);
    return attached;
  }

  /** A filled, edged rectangle: the ground a readout is legible against. */
  panel(
    rect: Rect,
    fill: string | null = PANEL,
    stroke: string | null = PANEL_EDGE,
    layer: number = LAYER.panel,
  ): ShapeComponent {
    const shape = this.add(
      new ShapeComponent({
        shape: { kind: "rect", width: rect.w, height: rect.h },
        fill: fill ?? undefined,
        stroke: stroke ?? undefined,
      }),
    );
    shape.layer = layer;
    placeRect(shape, rect);
    return shape;
  }

  /** One line, at the baseline `y`. */
  write(x: number, y: number, text: string, spec: TextSpec): TextComponent {
    const component = this.add(
      new TextComponent({
        text,
        font: fontOf(spec),
        fill: spec.fill ?? INK,
        align: spec.align ?? "left",
        baseline: "bottom",
      }),
    );
    component.layer = spec.layer ?? LAYER.text;
    component.offset.position = baseline(x, y, spec.size);
    return component;
  }

  /** Show or hide this group and everything under it. */
  apply(parentVisible = true): void {
    const on = parentVisible && this.visible;
    for (const part of this.parts) part.visible = on;
    for (const kid of this.kids) kid.apply(on);
  }
}

/** The CSS font a spec names. */
export const fontOf = (spec: TextSpec): string =>
  spec.face === "display"
    ? display(spec.size, spec.weight ?? 700)
    : mono(spec.size, spec.weight ?? 400);

/**
 * Where a line asked for at a baseline sits, as the `bottom`-anchored position
 * a `TextComponent`'s offset takes.
 */
export const baseline = (x: number, y: number, size: number): Vec3 =>
  vec3(x, y + size * DESCENT, 0);

/** Put a rectangular shape where a rect says, which is by its centre. */
export function placeRect(shape: ShapeComponent, rect: Rect): void {
  shape.shape = { kind: "rect", width: rect.w, height: rect.h };
  shape.offset.position = vec3(rect.x + rect.w / 2, rect.y + rect.h / 2, 0);
}

/** The margin every screen's readouts stand inside. */
export const MARGIN = 24;
