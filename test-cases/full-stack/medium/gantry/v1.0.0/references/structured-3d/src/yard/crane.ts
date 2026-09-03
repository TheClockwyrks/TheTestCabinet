// The crane's own geometry: the members, and the hoist cable hanging from the
// trolley.
//
// `specs/assets.md` puts the members in the half of the picture that is drawn
// in code, and `specs/overview.md` sets the bar they are drawn to: a strut, a
// cable, and a rail are told apart BY FORM — a square section, a thin rope, and
// a flat beam under a raised head — rather than by hue alone, which leaves hue
// free to carry the utilization ramp during a run.
//
// A member at breaking point glows and one past its limit pulses, so it stands
// out from every member below it; a broken one is charred, thin, and
// see-through, plainly still where it stood and plainly carrying nothing.

import * as THREE from "three";
import { Object3DComponent } from "@test-cabinet/structured-3d";
import { CREAK_THRESHOLD } from "../constants";
import { LAYER } from "../layers";
import {
  BROKEN,
  HOIST_CABLE,
  lighten,
  materialColour,
  OVER_LIMIT,
  RAIL_HEAD,
  utilizationColour,
} from "../palette";
import type { DrawnMember, YardPosture } from "../posture";
import { GantryView, type ViewFrame } from "../actor-view";
import { disposeTree, paint, poseBar, Pool } from "./three-kit";

/** How thick each material is drawn, across and through its own length. */
const PROFILE: Readonly<Record<string, { across: number; through: number }>> = {
  strut: { across: 0.17, through: 0.17 },
  rail: { across: 0.46, through: 0.15 },
  cable: { across: 0.075, through: 0.075 },
};

const BROKEN_PROFILE = { across: 0.09, through: 0.09 };
const HOIST_RADIUS = 0.06;

/** The colour a member reads at a utilization, and how hard it glows. */
export function memberHeat(
  utilization: number,
  pulse: number,
): { colour: number; glow: number } {
  if (utilization > 1) {
    return { colour: OVER_LIMIT, glow: 0.45 + 0.35 * Math.sin(pulse * 14) };
  }
  return {
    colour: utilizationColour(utilization),
    glow: utilization >= CREAK_THRESHOLD ? 0.28 : 0,
  };
}

export class CraneActor extends GantryView {
  private readonly group = new THREE.Group();
  private readonly barGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly ropeGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);

  private readonly bars: Pool<THREE.Mesh>;
  private readonly ropes: Pool<THREE.Mesh>;
  /**
   * Broken members keep a pool of their own. A pooled mesh is reused for a
   * different member each frame, and flipping one material between opaque and
   * transparent recompiles its shader, so the one translucent kind is kept
   * apart from the opaque ones.
   */
  private readonly broken: Pool<THREE.Mesh>;

  constructor() {
    super();
    this.group.name = "crane";
    const crane = this.attach(new Object3DComponent({ object: this.group }));
    crane.layer = LAYER.crane;

    this.bars = new Pool(this.group, () => this.makeBar(this.barGeometry));
    this.ropes = new Pool(this.group, () =>
      this.makeBar(this.ropeGeometry, "rope"),
    );
    this.broken = new Pool(this.group, () => {
      const mesh = this.makeBar(this.barGeometry, "broken");
      const material = mesh.material as THREE.MeshLambertMaterial;
      material.transparent = true;
      material.opacity = 0.55;
      material.color.setHex(BROKEN);
      return mesh;
    });
  }

  override refresh(frame: ViewFrame): void {
    this.bars.begin();
    this.ropes.begin();
    this.broken.begin();
    this.syncMembers(frame.posture, frame.state.simTime);
    this.syncRigging(frame.posture);
    this.bars.end();
    this.ropes.end();
    this.broken.end();
  }

  override endPlay(): void {
    disposeTree(this.group);
    this.barGeometry.dispose();
    this.ropeGeometry.dispose();
  }

  private makeBar(geometry: THREE.BufferGeometry, name = "member"): THREE.Mesh {
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
    );
    mesh.name = name;
    mesh.matrixAutoUpdate = false;
    return mesh;
  }

  private syncMembers(posture: YardPosture, pulse: number): void {
    for (const member of posture.members) {
      if (member.broken) {
        poseBar(
          this.broken.take(),
          member.a,
          member.b,
          BROKEN_PROFILE.across,
          BROKEN_PROFILE.through,
        );
        continue;
      }
      this.syncStanding(member, pulse);
    }
  }

  private syncStanding(member: DrawnMember, pulse: number): void {
    const profile = PROFILE[member.material] ?? PROFILE.strut;
    const bar =
      member.material === "cable" ? this.ropes.take() : this.bars.take();
    poseBar(bar, member.a, member.b, profile.across, profile.through);

    const utilization = member.utilization;
    if (utilization === null) {
      paint(bar, materialColour(member.material), 0);
    } else {
      const heat = memberHeat(utilization, pulse);
      paint(bar, heat.colour, heat.glow);
    }

    if (member.material !== "rail") return;
    // The head is the same colour as the beam under it, lifted a little for the
    // light: a rail is told apart by its FORM, and during a run its utilization
    // must read on the whole member rather than the web alone.
    const head = this.bars.take();
    poseBar(head, member.a, member.b, 0.18, 0.07, profile.through / 2 + 0.04);
    paint(
      head,
      utilization === null
        ? RAIL_HEAD
        : lighten(memberHeat(utilization, pulse).colour, 0.3),
      0,
    );
  }

  private syncRigging(posture: YardPosture): void {
    if (posture.cable === null) return;
    const rope = this.ropes.take();
    poseBar(
      rope,
      posture.cable.from,
      posture.cable.to,
      HOIST_RADIUS,
      HOIST_RADIUS,
    );
    paint(rope, HOIST_CABLE, 0);
  }
}
