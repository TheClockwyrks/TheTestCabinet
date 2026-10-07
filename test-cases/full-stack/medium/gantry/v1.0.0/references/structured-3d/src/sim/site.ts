// The six sites of `specs/sites.md`, read off `constants.ts` into the shape the
// simulation works in: positions as triples, and obstacles as the two corners
// the collision tests of `specs/statics.md` compare against.

import {
  LOAD_CLASS_DIMENSIONS,
  SITES,
  SITE_NAMES,
  type LoadClass as ConstantsLoadClass,
  type Obstacle as ConstantsObstacle,
  type Vec3 as Point,
} from "../constants";
import type { Box, LoadClass, SimSite, SiteLoad } from "./types";
import { type Vec3, vec3 } from "./vec";

const point = (p: Point): Vec3 => vec3(p.x, p.y, p.z);

/** An obstacle's two corners, from the minimum corner and the size a site states. */
export function obstacleBox(obstacle: ConstantsObstacle): Box {
  const min = point(obstacle.min);
  return {
    min,
    max: vec3(
      min[0] + obstacle.size.x,
      min[1] + obstacle.size.y,
      min[2] + obstacle.size.z,
    ),
  };
}

/** A load class's box, as width by height by depth at yaw `0`. */
export function classDimensions(cls: LoadClass): Vec3 {
  const d = LOAD_CLASS_DIMENSIONS[cls as ConstantsLoadClass];
  return vec3(d.x, d.y, d.z);
}

/** Half the class box on each axis, which is what the box test reads. */
export function classHalfExtents(cls: LoadClass): Vec3 {
  const d = classDimensions(cls);
  return vec3(d[0] / 2, d[1] / 2, d[2] / 2);
}

function toSimSite(index: number): SimSite {
  const s = SITES[index];
  const loads: SiteLoad[] = s.loads.map((l) => ({
    cls: l.class,
    mass: l.mass,
    from: { pos: vec3(l.from.x, l.from.y, l.from.z), yaw: l.from.yaw },
    to: { pos: vec3(l.to.x, l.to.y, l.to.z), yaw: l.to.yaw },
  }));
  return {
    name: SITE_NAMES[index],
    envelope: {
      min: vec3(s.envelope.x.min, s.envelope.y.min, s.envelope.z.min),
      max: vec3(s.envelope.x.max, s.envelope.y.max, s.envelope.z.max),
    },
    anchors: s.anchors.map(point),
    budget: s.budget,
    par: { cost: s.par.cost, time: s.par.time },
    loads,
    obstacles: s.obstacles.map(obstacleBox),
  };
}

/** The six sites, in the order `SITE_NAMES` names them. */
export const SIM_SITES: readonly SimSite[] = SITES.map((_site, i) =>
  toSimSite(i),
);

/** Whether a lattice node lies inside a site's build envelope, bounds included. */
export function insideEnvelope(envelope: Box, p: Vec3): boolean {
  return (
    p[0] >= envelope.min[0] &&
    p[0] <= envelope.max[0] &&
    p[1] >= envelope.min[1] &&
    p[1] <= envelope.max[1] &&
    p[2] >= envelope.min[2] &&
    p[2] <= envelope.max[2]
  );
}
