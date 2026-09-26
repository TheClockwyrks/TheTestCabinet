// The yard itself: the sky it stands under, the ground it stands on, the survey
// grid ruled over that ground, and the light everything is lit by.
//
// None of it moves, so this actor is built once and refreshes nothing. The sky
// dome and the grid are the game's own `three` objects, on `Object3DComponent`;
// the ground is a plain `MeshComponent`; the light is two `LightComponent`s,
// which is what a `standard` or `lambert` material needs to be anything but
// black (`engine/rendering.md`).

import * as THREE from "three";
import {
  LightComponent,
  MeshComponent,
  Object3DComponent,
  quatFromEuler,
  quatLookAt,
  vec3,
} from "@clockwyrks/structured-3d";
import { LATTICE_PITCH } from "../constants";
import { LAYER } from "../layers";
import {
  css,
  GROUND,
  GROUND_GRID,
  LIGHT_GROUND,
  LIGHT_SKY,
  LIGHT_SUN,
  SKY_HORIZON,
  SKY_ZENITH,
} from "../palette";
import { GantryView } from "../actor-view";

/** How far the sky dome stands, inside the camera's default far plane. */
const SKY_RADIUS = 420;

/** How far the ground reaches, and how far the survey grid is ruled. */
/** How far the yard floor reaches, on each axis (`specs/overview.md`). */
export const GROUND_REACH = 600;
const GRID_REACH = 48;

/** Where the sun stands, and the point it is aimed at. */
const SUN_AT = vec3(34, 52, 20);

/**
 * A dome of sky, shaded from the horizon haze up to the zenith through
 * per-vertex colours, drawn inside-out behind everything else.
 */
function skyDome(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(SKY_RADIUS, 24, 16);
  const position = geometry.attributes.position;
  const colours = new Float32Array(position.count * 3);
  const horizon = new THREE.Color(SKY_HORIZON);
  const zenith = new THREE.Color(SKY_ZENITH);
  const colour = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const t = Math.max(
      0,
      Math.min(1, (position.getY(i) / SKY_RADIUS) * 3 + 0.06),
    );
    colour.copy(horizon).lerp(zenith, t);
    colours[i * 3] = colour.r;
    colours[i * 3 + 1] = colour.g;
    colours[i * 3 + 2] = colour.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  const dome = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      depthWrite: false,
    }),
  );
  dome.name = "sky";
  return dome;
}

/** The survey grid ruled over the yard, on the lattice's own pitch. */
function surveyGrid(): THREE.LineSegments {
  const points: number[] = [];
  for (let i = -GRID_REACH; i <= GRID_REACH; i += LATTICE_PITCH) {
    points.push(
      i,
      0,
      -GRID_REACH,
      i,
      0,
      GRID_REACH,
      -GRID_REACH,
      0,
      i,
      GRID_REACH,
      0,
      i,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(points, 3),
  );
  const grid = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({
      color: GROUND_GRID,
      transparent: true,
      opacity: 0.28,
    }),
  );
  grid.name = "grid";
  grid.position.y = 0.005;
  return grid;
}

/**
 * The ground, the sky, and the light.
 *
 * The sun is a directional light with no shadow map: the engine builds the
 * light and keeps three's own shadow frustum, which spans ten units and would
 * cover a corner of a forty-unit yard, so the yard is modelled by the key and
 * the hemisphere fill rather than by a shadow that only half the site falls in.
 */
export class GroundActor extends GantryView {
  constructor() {
    super();

    const sky = this.attach(new Object3DComponent({ object: skyDome() }));
    sky.layer = LAYER.sky;

    const ground = this.attach(
      new MeshComponent({
        geometry: {
          kind: "plane",
          width: GROUND_REACH,
          height: GROUND_REACH,
        },
        material: { kind: "lambert", color: css(GROUND) },
      }),
    );
    ground.offset.position = vec3(0, -0.02, 0);
    ground.offset.rotation = quatFromEuler(-Math.PI / 2, 0, 0);
    ground.layer = LAYER.ground;

    const grid = this.attach(new Object3DComponent({ object: surveyGrid() }));
    grid.layer = LAYER.ground;

    this.attach(
      new LightComponent({
        light: {
          kind: "hemisphere",
          sky: css(LIGHT_SKY),
          ground: css(LIGHT_GROUND),
          intensity: 2.2,
        },
      }),
    );

    const sun = this.attach(
      new LightComponent({
        light: {
          kind: "directional",
          color: css(LIGHT_SUN),
          intensity: 2.6,
        },
      }),
    );
    sun.offset.position = SUN_AT;
    // A directional light shines along `FORWARD` turned by its world rotation,
    // so aiming it at the yard is one `lookAt` (`engine/components.md`).
    sun.offset.rotation = quatLookAt(vec3(-SUN_AT.x, -SUN_AT.y, -SUN_AT.z));
  }
}
