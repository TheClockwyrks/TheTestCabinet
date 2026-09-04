// The eight produced models, standing wherever their subjects are.
//
// `specs/assets.md` puts each model in the world at its subject's pose: the
// ring centred on the slew axis between its flanges and turning with the arm,
// the trolley on the track, the hook at the bob turned to the grip, a
// counterweight at each carrying node, a mount at each anchor, and each load at
// its pose — waiting, hanging, or placed.
//
// A `ModelComponent` clones the loaded model onto the actor it belongs to, so
// one load backs every copy on screen (`engine/models-and-animation.md`). The
// copies are pooled: a run places and unplaces them every tick, and a component
// left over from a busier frame is hidden rather than detached.

import * as THREE from "three";
import {
  ModelComponent,
  quatFromEuler,
  quatRotate,
  vec3,
} from "@test-cabinet/structured-3d";
import type { Model, Vec3 } from "@test-cabinet/structured-3d";
import { VOXELS_PER_UNIT } from "../constants";
import { LAYER } from "../layers";
import { models, type ModelName } from "../assets";
import { classDimensions, DEG } from "../sim";
import type { Placement, YardPosture } from "../posture";
import { GantryView, type ViewFrame } from "../actor-view";

/** The scale every produced model is drawn at (`specs/assets.md`). */
export const MODEL_SCALE = 1 / VOXELS_PER_UNIT;

/** How far under its node a counterweight hangs. */
const COUNTERWEIGHT_DROP = 0.75;

/**
 * The point of a loaded model that a placement names: the centre of its
 * footprint, at its lowest point, in the model's own units.
 *
 * `voxel` writes each model in voxel units from a corner of its own volume, so
 * this is what turns "stand the ring here" into where the clone's origin goes.
 */
export function modelAnchor(model: Model): Vec3 {
  const bounds = new THREE.Box3().setFromObject(model.scene);
  if (bounds.isEmpty()) return vec3(0, 0, 0);
  return vec3(
    (bounds.min.x + bounds.max.x) / 2,
    bounds.min.y,
    (bounds.min.z + bounds.max.z) / 2,
  );
}

/**
 * Where a model component's offset must sit for the model to stand at a
 * placement: the placement, less the anchor turned by the placement's yaw.
 *
 * The actor is at the identity, so the component's own offset carries the whole
 * pose, and `worldTransform` composes scale, then rotation, then translation
 * (`engine/math.md`).
 */
export function placementOffset(
  anchor: Vec3,
  placement: Placement,
): { position: Vec3; rotation: ReturnType<typeof quatFromEuler> } {
  // A positive yaw carries `+x` toward `+z` (`specs/world.md`), which is a
  // negative rotation about three's own `+y`.
  const rotation = quatFromEuler(0, -placement.yaw * DEG, 0);
  const turned = quatRotate(
    rotation,
    vec3(
      anchor.x * MODEL_SCALE,
      anchor.y * MODEL_SCALE,
      anchor.z * MODEL_SCALE,
    ),
  );
  return {
    position: vec3(
      placement.centre[0] - turned.x,
      placement.baseY - turned.y,
      placement.centre[2] - turned.z,
    ),
    rotation,
  };
}

/** The copies of one model on screen, taken and released a frame at a time. */
class ModelPool {
  private readonly items: ModelComponent[] = [];
  private readonly anchor: Vec3;
  private used = 0;

  constructor(
    private readonly owner: PartsActor,
    private readonly model: Model,
  ) {
    this.anchor = modelAnchor(model);
  }

  begin(): void {
    this.used = 0;
  }

  place(placement: Placement): void {
    let item = this.items[this.used];
    if (item === undefined) {
      item = this.owner.attach(new ModelComponent({ model: this.model }));
      item.layer = LAYER.parts;
      item.offset.scale = vec3(MODEL_SCALE, MODEL_SCALE, MODEL_SCALE);
      this.items.push(item);
    }
    const { position, rotation } = placementOffset(this.anchor, placement);
    item.offset.position = position;
    item.offset.rotation = rotation;
    item.visible = true;
    this.used += 1;
  }

  end(): void {
    for (let i = this.used; i < this.items.length; i++) {
      this.items[i].visible = false;
    }
  }

  /** How many copies this pool has built, which a test counts. */
  get size(): number {
    return this.items.length;
  }
}

export class PartsActor extends GantryView {
  private readonly pools: Record<ModelName, ModelPool>;

  constructor() {
    super();
    const loaded = models();
    this.pools = {
      ring: new ModelPool(this, loaded.ring),
      trolley: new ModelPool(this, loaded.trolley),
      hook: new ModelPool(this, loaded.hook),
      counterweight: new ModelPool(this, loaded.counterweight),
      mount: new ModelPool(this, loaded.mount),
      crate: new ModelPool(this, loaded.crate),
      container: new ModelPool(this, loaded.container),
      drum: new ModelPool(this, loaded.drum),
    };
  }

  override refresh(frame: ViewFrame): void {
    for (const pool of Object.values(this.pools)) pool.begin();
    this.placeAll(frame.posture);
    for (const pool of Object.values(this.pools)) pool.end();
  }

  private placeAll(posture: YardPosture): void {
    for (const anchor of posture.anchors) {
      this.pools.mount.place({
        centre: anchor,
        baseY: anchor[1],
        yaw: 0,
      });
    }
    for (const node of posture.counterweights) {
      this.pools.counterweight.place({
        centre: node,
        baseY: node[1] - COUNTERWEIGHT_DROP,
        yaw: posture.slew,
      });
    }
    if (posture.ring !== null) this.pools.ring.place(posture.ring);
    if (posture.trolley !== null) this.pools.trolley.place(posture.trolley);
    if (posture.hook !== null) this.pools.hook.place(posture.hook);
    for (const load of posture.loads) {
      const dimensions = classDimensions(load.cls);
      this.pools[load.cls].place({
        centre: load.pos,
        baseY: load.pos[1] - dimensions[1],
        yaw: load.yaw,
      });
    }
  }
}
