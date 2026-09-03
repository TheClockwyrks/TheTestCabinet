// What the last frame drew, as `specs/instrumentation.md` § Readings requires
// `drawn()` to report it.
//
// The frame already knows all of this. `render-posture.ts` turns the game state
// into a `YardPosture` — every member, model, mark, aid and obstacle at the world
// position the frame is about to draw it at — and `render-scene.ts` then puts that
// posture on screen. So the reading is not a second description of the yard kept
// in step with the first: it is the same posture the frame drew, mapped to the
// shape the specification names, plus the two things the posture does not carry
// because only the scene knows them — the colour each thing was painted and the
// size each model's decoded geometry came out at.
//
// One entry per THING, not per piece of geometry. The lattice aid is thousands of
// points and one entry; a member is one entry whatever its cross-section is built
// from. What the specification asks is which things the frame put on screen and
// where, and a reader counting entries is counting things.

import * as THREE from "three";
import type { ModelName } from "./assets";
import { classDimensions, type Vec3 } from "./sim";
import * as palette from "./render-palette";
import type { YardPosture } from "./render-posture";

/** One thing the frame drew (`specs/instrumentation.md`). */
export interface DrawnEntry {
  readonly kind:
    | "model"
    | "member"
    | "aid"
    | "mark"
    | "obstacle"
    | "cable"
    | "ground"
    | "text";
  readonly name: string;
  readonly id: number | null;
  readonly source: string | null;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly size: readonly [number, number, number];
  readonly color: readonly [number, number, number];
  readonly text: string | null;
}

/**
 * What each decoded model came out as, once it is loaded: the world extent it is
 * drawn at, and one representative colour taken from its own vertices. Neither
 * follows from the posture — the posture says where a model stands, and this says
 * what standing it up actually put on screen.
 */
export interface DrawnModel {
  readonly size: readonly [number, number, number];
  readonly color: number;
}

/** Every model the build has decoded, by name. */
export type ModelSizes = Partial<Record<ModelName, DrawnModel>>;

const rgb = (hex: number): readonly [number, number, number] => [
  (hex >> 16) & 0xff,
  (hex >> 8) & 0xff,
  hex & 0xff,
];

const ZERO: readonly [number, number, number] = [0, 0, 0];

interface EntryFields {
  kind: DrawnEntry["kind"];
  name: string;
  at: Vec3;
  color: number;
  size?: readonly [number, number, number];
  yaw?: number;
  id?: number | null;
  source?: string | null;
  text?: string | null;
}

const entry = (fields: EntryFields): DrawnEntry => ({
  kind: fields.kind,
  name: fields.name,
  id: fields.id ?? null,
  source: fields.source ?? null,
  x: fields.at[0],
  y: fields.at[1],
  z: fields.at[2],
  yaw: fields.yaw ?? 0,
  size: fields.size ?? ZERO,
  color: rgb(fields.color),
  text: fields.text ?? null,
});

/** The midpoint of two world points. */
const midpoint = (a: Vec3, b: Vec3): Vec3 => [
  (a[0] + b[0]) / 2,
  (a[1] + b[1]) / 2,
  (a[2] + b[2]) / 2,
];

/** The axis-aligned extent spanned by two world points. */
const span = (a: Vec3, b: Vec3): readonly [number, number, number] => [
  Math.abs(b[0] - a[0]),
  Math.abs(b[1] - a[1]),
  Math.abs(b[2] - a[2]),
];

/** The yaw of the horizontal direction from `a` to `b`, in degrees. */
const yawOf = (a: Vec3, b: Vec3): number =>
  (Math.atan2(b[2] - a[2], b[0] - a[0]) * 180) / Math.PI;

/**
 * The colour a member is drawn in: its material's own while nothing has solved
 * it, its place on the utilization ramp once something has, and the broken shade
 * once this run has broken it (`specs/overview.md`).
 */
function memberColour(member: {
  material: string;
  broken: boolean;
  utilization: number | null;
}): number {
  if (member.broken) return palette.BROKEN;
  if (member.utilization === null) {
    if (member.material === "strut") return palette.STRUT;
    if (member.material === "rail") return palette.RAIL;
    return palette.CABLE;
  }
  if (member.utilization > 1) return palette.OVER_LIMIT;
  return palette.utilizationColour(member.utilization);
}

/** A model standing at a placement, sized as its geometry decoded. */
function model(
  name: ModelName,
  at: { centre: Vec3; baseY: number; yaw: number },
  sizes: ModelSizes,
  colour: number,
): DrawnEntry {
  const drawn = sizes[name];
  const size = drawn?.size ?? ZERO;
  return entry({
    kind: "model",
    name,
    // The position a model is drawn AT is the centre of what was drawn, so a
    // reader comparing it against a world position the game reports compares two
    // points of the same kind. The posture carries the footprint centre and the
    // base, which is how the scene stands one up.
    at: [at.centre[0], at.baseY + size[1] / 2, at.centre[2]],
    yaw: at.yaw,
    size,
    color: drawn?.color ?? colour,
    source: `${name}.glb`,
  });
}

/**
 * Everything the frame drew in the yard.
 *
 * `aids` says whether the build screen's lattice and envelope aids were shown,
 * `marks` which of the build-screen marks were, and `texts` the runs of text the
 * frame drew over the scene. The run screen draws neither aid, so a caller on it
 * passes them off and the reading has no entry for them — which is the reading
 * saying they were not drawn.
 */
export function describeFrame(input: {
  posture: YardPosture;
  sizes: ModelSizes;
  aids: { lattice: boolean; envelope: boolean };
  marks: {
    anchors: boolean;
    loadStarts: boolean;
    pads: boolean;
    pendingNode: Vec3 | null;
    pickedNode: Vec3 | null;
  };
  texts: readonly { name: string; text: string }[];
  groundSize: number;
}): DrawnEntry[] {
  const { posture, sizes, aids, marks, texts } = input;
  const out: DrawnEntry[] = [];

  out.push(
    entry({
      kind: "ground",
      name: "ground",
      at: [0, 0, 0],
      size: [input.groundSize, 0, input.groundSize],
      color: palette.GROUND,
    }),
  );

  for (const member of posture.members) {
    out.push(
      entry({
        kind: "member",
        name: member.material,
        id: member.id,
        at: midpoint(member.a, member.b),
        yaw: yawOf(member.a, member.b),
        size: span(member.a, member.b),
        color: memberColour(member),
      }),
    );
  }

  if (posture.ring !== null) {
    out.push(model("ring", posture.ring, sizes, palette.STRUT));
  }
  if (posture.trolley !== null) {
    out.push(model("trolley", posture.trolley, sizes, palette.STRUT));
  }
  if (posture.hook !== null) {
    out.push(model("hook", posture.hook, sizes, palette.STRUT));
  }
  for (const node of posture.counterweights) {
    out.push(
      model(
        "counterweight",
        { centre: node, baseY: node[1], yaw: 0 },
        sizes,
        palette.STRUT,
      ),
    );
  }
  for (const anchor of posture.anchors) {
    out.push(
      model(
        "mount",
        { centre: anchor, baseY: anchor[1], yaw: 0 },
        sizes,
        palette.ANCHOR_PLATE,
      ),
    );
    if (marks.anchors) {
      out.push(
        entry({
          kind: "mark",
          name: "anchor",
          at: anchor,
          color: palette.ANCHOR_PLATE,
        }),
      );
    }
  }

  for (const load of posture.loads) {
    if (load.phase === "lost") continue;
    const box = classDimensions(load.cls);
    out.push(
      model(
        load.cls,
        { centre: load.pos, baseY: load.pos[1], yaw: load.yaw },
        sizes,
        palette.PAD,
      ),
    );
    if (marks.loadStarts && load.phase === "waiting") {
      out.push(
        entry({
          kind: "mark",
          name: "load-start",
          at: load.pos,
          yaw: load.yaw,
          size: box,
          color: palette.PAD,
        }),
      );
    }
  }

  if (marks.pads) {
    for (const pad of posture.pads) {
      out.push(
        entry({
          kind: "mark",
          name: "pad",
          at: pad.pos,
          yaw: pad.yaw,
          size: classDimensions(pad.cls),
          color: palette.PAD,
        }),
      );
      out.push(
        entry({
          kind: "mark",
          name: "pad-yaw",
          at: pad.pos,
          yaw: pad.yaw,
          color: palette.PAD,
        }),
      );
    }
  }

  if (marks.pendingNode !== null) {
    out.push(
      entry({
        kind: "mark",
        name: "pending-node",
        at: marks.pendingNode,
        color: palette.PENDING_NODE,
      }),
    );
  }
  if (marks.pickedNode !== null) {
    out.push(
      entry({
        kind: "mark",
        name: "picked-node",
        at: marks.pickedNode,
        color: palette.PICK_NODE,
      }),
    );
  }

  for (const box of posture.obstacles) {
    out.push(
      entry({
        kind: "obstacle",
        name: "obstacle",
        at: midpoint(box.min, box.max),
        size: span(box.min, box.max),
        color: palette.OBSTACLE,
      }),
    );
  }

  if (posture.cable !== null) {
    out.push(
      entry({
        kind: "cable",
        name: "hoist",
        at: midpoint(posture.cable.from, posture.cable.to),
        size: span(posture.cable.from, posture.cable.to),
        color: palette.HOIST_CABLE,
      }),
    );
  }

  if (aids.lattice) {
    out.push(
      entry({
        kind: "aid",
        name: "lattice",
        at: midpoint(posture.envelope.min, posture.envelope.max),
        size: span(posture.envelope.min, posture.envelope.max),
        color: palette.LATTICE,
      }),
    );
  }
  if (aids.envelope) {
    out.push(
      entry({
        kind: "aid",
        name: "envelope",
        at: midpoint(posture.envelope.min, posture.envelope.max),
        size: span(posture.envelope.min, posture.envelope.max),
        color: palette.ENVELOPE,
      }),
    );
  }

  for (const run of texts) {
    out.push(
      entry({
        kind: "text",
        name: run.name,
        at: [0, 0, 0],
        color: 0xffffff,
        text: run.text,
      }),
    );
  }

  return out;
}

/**
 * What standing one decoded model up puts on screen: the world extent it covers
 * at the scale `specs/assets.md` fixes, and the colour most of its surface
 * carries.
 *
 * The engine decodes a produced file into scene geometry, so this measures the
 * object the engine handed back rather than the file's own vertices. The size is
 * measured rather than taken from the table in `specs/assets.md`, because the
 * table states what a model should be sized about and this has to report what it
 * actually came out as.
 */
export function measureModelObject(object: THREE.Object3D): DrawnModel {
  object.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(object);
  const size: readonly [number, number, number] = bounds.isEmpty()
    ? ZERO
    : [
        bounds.max.x - bounds.min.x,
        bounds.max.y - bounds.min.y,
        bounds.max.z - bounds.min.z,
      ];

  // The representative colour is the mean of the vertex colours, which is the
  // one that carries the most of a surface however the voxels are distributed.
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    const colors = mesh.geometry?.getAttribute?.("color");
    if (colors === undefined) return;
    for (let i = 0; i < colors.count; i += 1) {
      r += colors.getX(i);
      g += colors.getY(i);
      b += colors.getZ(i);
      n += 1;
    }
  });
  const to255 = (v: number): number =>
    Math.max(0, Math.min(255, Math.round((n === 0 ? 0 : v / n) * 255)));
  return { size, color: (to255(r) << 16) | (to255(g) << 8) | to255(b) };
}
