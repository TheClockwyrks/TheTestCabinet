// What a check reads off the canvas as TEXT.
//
// Every case fixes copy for some of its screens — a title, a menu's items, a
// readout's figure — and leaves the presentation to the build. So a screen is
// read twice over: from what the surface reports, and from the words the frame
// actually drew. These are the second half of that.
//
// MATCHING IS BY SUBSTRING, NEVER BY EQUALITY. The words are the case's; how a
// build presents them is the build's, and a menu item is commonly drawn with a
// selection marker or padding around it. Requiring the exact run would fail a
// screen showing precisely the right words.
//
// ONE NAME IS TAKEN, AND ONE CASE MEANS SOMETHING ELSE BY IT. `drawnText` here
// answers the RUNS, as an array. A case whose own `drawnText` answers the runs
// folded into one string means a different function, and it keeps that name for
// itself and reaches this one under its other name — see the README's collision
// table. Two functions answering different types under one name is exactly the
// drift that four copies of this file produced.

import { callsTo, type DrawCall } from "./draw-calls";
import { apply, IDENTITY, numbers, transformed, type Matrix } from "./matrix";

/** Every string the frame drew, through `fillText` or `strokeText`. */
export function drawnText(calls: readonly DrawCall[]): string[] {
  return [
    ...callsTo(calls, "fillText"),
    ...callsTo(calls, "strokeText"),
  ].flatMap((args) => (typeof args[0] === "string" ? [args[0]] : []));
}

/**
 * Whether the frame drew `text` as part of some run of text, ignoring case.
 *
 * Substring rather than equality, for the reason in this module's header.
 */
export function drewText(calls: readonly DrawCall[], text: string): boolean {
  const wanted = text.trim().toLowerCase();
  return drawnText(calls).some((drawn) => drawn.toLowerCase().includes(wanted));
}

/** One run of text a frame drew, and where it drew it in canvas pixels. */
export interface TextDraw {
  text: string;
  /** The anchor the run was drawn at, mapped through the transform in force. */
  x: number;
  y: number;
}

/**
 * Every run of text the frame drew, with its anchor in canvas pixels.
 *
 * A build is free to draw under a transform — to translate to a HUD corner and
 * draw at the origin, say — so the position a `fillText` names is only where the
 * text landed once the transform in force at that call is applied. This walks the
 * frame's operations carrying that transform, through `save`/`restore` and every
 * operation {@link transformed} knows. At the harness's default shape the canvas
 * is the stage at one pixel per unit, so the result is in logical units as well.
 */
export function textDraws(calls: readonly DrawCall[]): TextDraw[] {
  const draws: TextDraw[] = [];
  const stack: Matrix[] = [];
  let current: Matrix = IDENTITY;
  for (const call of calls) {
    if (call.kind !== "call") continue;
    const { method, args } = call;
    if (method === "save") {
      stack.push(current);
      continue;
    }
    if (method === "restore") {
      current = stack.pop() ?? IDENTITY;
      continue;
    }
    const moved = transformed(current, method, args);
    if (moved !== null) {
      current = moved;
      continue;
    }
    if (method !== "fillText" && method !== "strokeText") continue;
    const [text] = args;
    const at = numbers(args.slice(1), 2);
    if (typeof text !== "string" || at === null) continue;
    draws.push({ text, ...apply(current, at[0], at[1]) });
  }
  return draws;
}
