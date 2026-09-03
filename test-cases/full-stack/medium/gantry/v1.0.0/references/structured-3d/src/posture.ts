// Where everything in the yard stands this frame.
//
// The picture is described from one reading of the state rather than from a
// dozen scattered ones, and this module is that reading: it turns the state
// into the world positions, yaws, and utilizations the scene needs, and it
// touches no `three` object, no actor, and no component, so it runs — and is
// tested — in Node.
//
// It writes nothing. Every position it reports is derived: the simulation's own
// `computeGeometry` poses a run, and outside a run the crane stands at the
// run-start posture `specs/program.md` fixes, which is the posture the static
// check reads too.

import { HOIST_START, LATTICE_PITCH } from "./constants";
import { simMember, simStructure, triple } from "./adapt";
import {
  computeGeometry,
  DEG,
  memberLength,
  nodeKey,
  railTrack,
  rotateAboutY,
  slewAxis,
  type Box,
  type LoadClass,
  type LoadPhase,
  type Material,
  type SimSite,
  type Structure as SimStructure,
  type Vec3 as SimVec3,
} from "./sim";
import { currentSite, currentStructure } from "./state";
import type { GantryState } from "./game";

/** One member, as the scene draws it. */
export interface DrawnMember {
  readonly id: number;
  readonly a: SimVec3;
  readonly b: SimVec3;
  readonly material: Material;
  readonly length: number;
  /**
   * Its utilization on the ramp, or `null` when nothing has solved it — before
   * a run, and before the `check` action has anything to say.
   */
  readonly utilization: number | null;
  /** Whether this run has broken it (`specs/statics.md`). */
  readonly broken: boolean;
}

/** One load, wherever it stands: waiting, hanging, or set down. */
export interface DrawnLoad {
  readonly cls: LoadClass;
  readonly pos: SimVec3;
  readonly yaw: number;
  readonly phase: LoadPhase;
}

/** One pad: the class outline a load must be set down inside, at its yaw. */
export interface DrawnPad {
  readonly cls: LoadClass;
  /** The target lift point, from which the footprint and its height follow. */
  readonly pos: SimVec3;
  readonly yaw: number;
  readonly placed: boolean;
}

/** A produced model standing somewhere, by its footprint centre and its base. */
export interface Placement {
  /** The horizontal centre of the model's footprint. */
  readonly centre: SimVec3;
  /** The world `y` its lowest point sits at. */
  readonly baseY: number;
  /** Its yaw in degrees, on the world frame (`specs/world.md`). */
  readonly yaw: number;
}

/** The whole yard, posed. */
export interface YardPosture {
  /** The arm's angle this frame. */
  readonly slew: number;
  /** Whether a run is posing the yard, rather than the build posture. */
  readonly live: boolean;
  readonly members: readonly DrawnMember[];
  /** Every node carrying a counterweight, at its posed world position. */
  readonly counterweights: readonly SimVec3[];
  readonly ring: Placement | null;
  readonly trolley: Placement | null;
  /** The hook block, hanging at the bob and turned to the grip. */
  readonly hook: Placement | null;
  /** The hoist cable, pivot to bob (`specs/rigging.md`). */
  readonly cable: { readonly from: SimVec3; readonly to: SimVec3 } | null;
  readonly loads: readonly DrawnLoad[];
  readonly pads: readonly DrawnPad[];
  readonly anchors: readonly SimVec3[];
  readonly obstacles: readonly Box[];
  readonly envelope: Box;
}

const yawOf = (direction: SimVec3): number =>
  Math.atan2(direction[2], direction[0]) / DEG;

/**
 * Every lattice node inside an envelope: the points whose coordinates are all
 * integer multiples of `LATTICE_PITCH` (`specs/world.md`). It is the set the
 * build screen draws as its lattice aid, and the set a node pick considers.
 */
export function latticeNodes(envelope: Box): SimVec3[] {
  const nodes: SimVec3[] = [];
  const first = (v: number): number =>
    Math.ceil(v / LATTICE_PITCH) * LATTICE_PITCH;
  for (
    let x = first(envelope.min[0]);
    x <= envelope.max[0];
    x += LATTICE_PITCH
  ) {
    for (
      let y = first(envelope.min[1]);
      y <= envelope.max[1];
      y += LATTICE_PITCH
    ) {
      for (
        let z = first(envelope.min[2]);
        z <= envelope.max[2];
        z += LATTICE_PITCH
      ) {
        nodes.push([x, y, z]);
      }
    }
  }
  return nodes;
}

/** The rigging alone: the trolley, the hook, and the cable between them. */
type Rigging = Pick<YardPosture, "trolley" | "hook" | "cable">;

/** The run-start posture the crane stands in outside a run (`specs/program.md`). */
function buildPosture(site: SimSite, structure: SimStructure): Rigging {
  const track = railTrack(structure, site.anchors);
  if (!track.ok) return { trolley: null, hook: null, cable: null };
  const pivot = track.origin;
  const bob: SimVec3 = [pivot[0], pivot[1] - HOIST_START, pivot[2]];
  return {
    trolley: { centre: pivot, baseY: pivot[1], yaw: yawOf(track.direction) },
    hook: { centre: bob, baseY: bob[1], yaw: 0 },
    cable: { from: pivot, to: bob },
  };
}

/**
 * The yard as this frame draws it.
 *
 * A run poses the crane through the simulation's own geometry, so what is drawn
 * is what the solves read; outside a run the crane stands at the run-start
 * posture, which is the one the static check solves at.
 */
export function yardPosture(state: GantryState): YardPosture {
  const site = currentSite(state);
  const structure = simStructure(currentStructure(state));
  const run = state.run;
  const live = run.phase !== "idle";
  const ring = structure.ring;
  const slew = live ? run.axes.slew.value : 0;

  const intact = live ? run.intact : structure.members;
  const intactIds = new Set(intact.map((m) => m.id));
  const forces = new Map<number, number>();
  if (live) {
    for (const f of run.forces) forces.set(f.id, f.utilization);
  } else if (state.checkResult !== null) {
    for (const f of state.checkResult.members) forces.set(f.id, f.utilization);
  }

  let positions: ReadonlyMap<string, SimVec3> = new Map();
  if (ring !== null) {
    positions = computeGeometry(
      { ...structure, members: intact },
      intact,
      site.anchors,
      slewAxis(ring),
      slew,
    ).positions;
  }
  const at = (node: SimVec3): SimVec3 => positions.get(nodeKey(node)) ?? node;

  const members: DrawnMember[] = currentStructure(state).members.map((m) => {
    const sim = simMember(m);
    return {
      id: sim.id,
      a: at(sim.a),
      b: at(sim.b),
      material: sim.material,
      length: memberLength(sim),
      utilization: forces.get(sim.id) ?? null,
      broken: !intactIds.has(sim.id),
    };
  });

  const cos = Math.cos(slew * DEG);
  const sin = Math.sin(slew * DEG);
  const ringPlacement: Placement | null =
    ring === null
      ? null
      : {
          centre: [
            slewAxis(ring)[0],
            ring.corner[1] + LATTICE_PITCH / 2,
            slewAxis(ring)[1],
          ],
          baseY: ring.corner[1],
          yaw: slew,
        };

  let rigging: Rigging;
  if (!live) {
    rigging = buildPosture(site, structure);
  } else {
    const track = railTrack({ ...structure, members: intact }, site.anchors);
    const direction: SimVec3 = track.ok
      ? rotateAboutY(track.direction, [0, 0], cos, sin)
      : [1, 0, 0];
    const pivot = triple(run.pivot);
    const bob = triple(run.bob.pos);
    rigging = {
      trolley: { centre: pivot, baseY: pivot[1], yaw: yawOf(direction) },
      hook: { centre: bob, baseY: bob[1], yaw: run.axes.grip.value },
      cable: { from: pivot, to: bob },
    };
  }

  const loads: DrawnLoad[] = live
    ? run.loads.flatMap((load, i) => {
        const authored = site.loads[i];
        if (authored === undefined || load.phase === "lost") return [];
        return [
          {
            cls: authored.cls,
            pos: triple(load.pos),
            yaw: load.yaw,
            phase: load.phase,
          },
        ];
      })
    : site.loads.map((load) => ({
        cls: load.cls,
        pos: load.from.pos,
        yaw: load.from.yaw,
        phase: "waiting" as LoadPhase,
      }));

  const pads: DrawnPad[] = site.loads.map((load, i) => ({
    cls: load.cls,
    pos: load.to.pos,
    yaw: load.to.yaw,
    placed: live && run.loads[i]?.phase === "placed",
  }));

  return {
    slew,
    live,
    members,
    counterweights: structure.counterweights.map(at),
    ring: ringPlacement,
    ...rigging,
    loads,
    pads,
    anchors: site.anchors,
    obstacles: site.obstacles,
    envelope: site.envelope,
  };
}
