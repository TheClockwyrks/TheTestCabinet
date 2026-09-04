// Arc Foundry — where a frame's operations landed. CASE-PROVIDED, LOCAL TO THIS CATEGORY.
//
// WHY THIS EXISTS. `specs/pathing.md` requires the waypoint order numbers to be
// drawn LAST, over the structures and the units, and the only way to decide an
// ORDER is to read the frame's operations in the order they were issued. Under
// this engine the game draws through the raw 2D context, so a structure and a unit
// are whatever primitives the build chose for them — a fill, a stroke, an arc, a
// blit — and `reading.ts`'s `imageDraws` reads only one of those. So what is needed
// is a way to ask, of a whole frame, WHERE each operation landed, and that is what
// this file answers.
//
// HOW AN OPERATION IS LOCATED. Every drawing primitive the 2D context offers
// carries its coordinates in its arguments, and those coordinates are in the space
// the transform in force at the call maps onto the stage. So the transform is
// tracked exactly as `reading.ts` tracks it for text, each operation's own points
// are mapped through it, and an operation is "in" a box when one of those points
// is. A point rather than an outline on purpose: a grid line spanning the whole
// yard passes through everything and belongs to none of it, and its endpoints sit
// at the yard's edges, so locating an operation by the points it NAMES keeps a
// long line out of a small box while keeping every primitive a build might draw a
// structure with inside one.

/** A rectangle on the stage, in logical units. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

import type { DrawCall } from "../harness";

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function at(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/** `count` numbers from `args`, starting at `from`, or `null`. */
function numbers(
  args: readonly unknown[],
  from: number,
  count: number,
): number[] | null {
  const taken: number[] = [];
  for (let i = from; i < from + count; i += 1) {
    const value = args[i];
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    taken.push(value);
  }
  return taken;
}

/**
 * The points one drawing operation names, in the space the call was made in.
 *
 * Every primitive that puts ink somewhere is here, and everything else — a state
 * change, a path that only closes, a transform — names no point and so lands
 * nowhere.
 */
function pointsOf(method: string, args: readonly unknown[]): number[][] {
  const pairs = (from: number, count: number): number[][] => {
    const taken = numbers(args, from, count * 2);
    if (taken === null) return [];
    const out: number[][] = [];
    for (let i = 0; i < count; i += 1)
      out.push([taken[i * 2]!, taken[i * 2 + 1]!]);
    return out;
  };
  switch (method) {
    case "fillRect":
    case "strokeRect":
    case "clearRect":
    case "rect":
    case "roundRect": {
      const box = numbers(args, 0, 4);
      if (box === null) return [];
      const [x, y, w, hh] = box as [number, number, number, number];
      return [
        [x, y],
        [x + w, y],
        [x, y + hh],
        [x + w, y + hh],
        [x + w / 2, y + hh / 2],
      ];
    }
    case "arc":
    case "ellipse":
      return pairs(0, 1);
    case "moveTo":
    case "lineTo":
      return pairs(0, 1);
    case "quadraticCurveTo":
      return pairs(0, 2);
    case "bezierCurveTo":
      return pairs(0, 3);
    case "arcTo":
      return pairs(0, 2);
    case "fillText":
    case "strokeText":
      return pairs(1, 1);
    case "drawImage": {
      if (args.length >= 9) {
        const box = numbers(args, 5, 4);
        if (box === null) return [];
        const [x, y, w, hh] = box as [number, number, number, number];
        return [
          [x, y],
          [x + w, y],
          [x, y + hh],
          [x + w, y + hh],
        ];
      }
      if (args.length >= 5) {
        const box = numbers(args, 1, 4);
        if (box === null) return [];
        const [x, y, w, hh] = box as [number, number, number, number];
        return [
          [x, y],
          [x + w, y],
          [x, y + hh],
          [x + w, y + hh],
        ];
      }
      return pairs(1, 1);
    }
    default:
      return [];
  }
}

function inBox(box: Box, x: number, y: number): boolean {
  return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
}

/**
 * Where in the frame the last operation landing inside any of `boxes` sat, or
 * `-1` when the frame put nothing there.
 *
 * The index is the operation's own place in the frame's list, so two of them
 * compare directly against each other and against a text draw's `index`.
 */
export function lastOpIn(
  calls: readonly DrawCall[],
  boxes: readonly Box[],
): number {
  const stack: Matrix[] = [];
  let m: Matrix = IDENTITY;
  let last = -1;
  calls.forEach((call, index) => {
    if (call.kind !== "call") return;
    const { method, args } = call;
    if (method === "save") {
      stack.push(m);
    } else if (method === "restore") {
      m = stack.pop() ?? IDENTITY;
    } else if (method === "translate") {
      const v = numbers(args, 0, 2);
      if (v) m = multiply(m, [1, 0, 0, 1, v[0]!, v[1]!]);
    } else if (method === "scale") {
      const v = numbers(args, 0, 2);
      if (v) m = multiply(m, [v[0]!, 0, 0, v[1]!, 0, 0]);
    } else if (method === "rotate") {
      const v = numbers(args, 0, 1);
      if (v) {
        const c = Math.cos(v[0]!);
        const s = Math.sin(v[0]!);
        m = multiply(m, [c, s, -s, c, 0, 0]);
      }
    } else if (method === "transform") {
      const v = numbers(args, 0, 6);
      if (v) m = multiply(m, v as Matrix);
    } else if (method === "setTransform") {
      const v = numbers(args, 0, 6);
      m = v ? (v as Matrix) : IDENTITY;
    } else if (method === "resetTransform") {
      m = IDENTITY;
    }
    for (const [x, y] of pointsOf(method, args)) {
      const point = at(m, x!, y!);
      if (boxes.some((box) => inBox(box, point.x, point.y))) last = index;
    }
  });
  return last;
}
