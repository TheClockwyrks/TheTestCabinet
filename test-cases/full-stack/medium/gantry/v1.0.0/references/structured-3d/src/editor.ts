// The structure editor: picking on the build screen, and the edits the tools
// and the debug surface commit.
//
// Two halves live here. The first is picking (`specs/controls.md`): the lattice
// node and the member a click at the pointer's position would take, decided in
// logical stage units through the one projection `src/view.ts` owns, so what is
// picked is what the engine draws. The second is the edits: every one passes
// the rules of `specs/structure.md`, which are `src/sim/structure.ts`'s and are
// called rather than restated.
//
// The state is live, so an edit writes it in place and reports what it did: a
// cue when something was placed or removed, and the rule that refused it when
// the rules refused it, so the build screen can show why a click did nothing.

import { LATTICE_PITCH, MEMBER_PICK_PX, NODE_PICK_PX } from "./constants";
import { point, simMember, simStructure, triple } from "./adapt";
import { cameraBasis, project, type CameraBasis } from "./view";
import {
  add,
  checkCounterweightPlacement,
  checkMemberPlacement,
  checkRingPlacement,
  distance,
  dot,
  flangeNodes,
  nodeKey,
  scale,
  staticCheck,
  sub,
  type Box,
  type EditRefusal,
  type Material,
  type Member as SimMember,
  type Vec3 as SimVec3,
} from "./sim";
import {
  clearPendingNode,
  copyStructure,
  currentProgram,
  currentSite,
  currentStructure,
  emptyStructure,
  setPendingNode,
} from "./state";
import type { Camera, GantryState, Structure, Vec3 } from "./game";

/** What a click at a stage position would take (`specs/controls.md`). */
export interface Pick {
  /** The picked lattice node, or `null` with none in range. */
  node: Vec3 | null;
  /** The picked member's id, or `null` with none in range. */
  member: number | null;
}

/**
 * What an edit did. `cue` is the sound it raises (`specs/ui.md`), `null` when
 * nothing was placed or removed; `refusal` names the rule that refused it, and
 * is `null` when the edit landed or when there was simply nothing to remove.
 */
export interface EditOutcome {
  cue: "place" | "delete" | null;
  refusal: EditRefusal | null;
}

/** An edit that changed nothing and raised nothing. */
const unchanged = (): EditOutcome => ({ cue: null, refusal: null });

/** An edit the rules refused. */
const refused = (refusal: EditRefusal): EditOutcome => ({
  cue: null,
  refusal,
});

// ---- The camera the picking is measured through ----------------------------

/**
 * How far in front of the camera a point must stand to be projected. A point on
 * the camera's own plane has no projection at all, so a segment crossing that
 * plane is cut a hair in front of it.
 */
const NEAR = 1e-6;

/**
 * Two distances this close are one distance, so a tie is decided by the order
 * `specs/controls.md` fixes rather than by the last bit of a float.
 */
const TIE_EPS = 1e-9;

/** How far in front of the camera a world position stands. */
const depthOf = (view: CameraBasis, p: SimVec3): number =>
  dot(sub(p, view.eye), view.forward);

/** `-1`, `0`, or `1`, with distances inside `TIE_EPS` counted equal. */
const compare = (a: number, b: number): number =>
  Math.abs(a - b) <= TIE_EPS ? 0 : a < b ? -1 : 1;

// ---- Picking ---------------------------------------------------------------

/** One lattice node in range of the click, with what breaks its ties. */
interface NodeCandidate {
  readonly node: SimVec3;
  /** Stage distance from the click, in logical pixels. */
  readonly dist: number;
  /** Distance from the camera, which is the first tie-break. */
  readonly cam: number;
}

/** One member in range of the click, with what breaks its ties. */
interface MemberCandidate {
  readonly id: number;
  readonly dist: number;
  /** How far the nearest point on the segment stands from the camera. */
  readonly cam: number;
}

/**
 * A lattice node's candidacy: `null` when it does not stand in front of the
 * camera, which is the whole of what a node pick leaves out
 * (`specs/controls.md`).
 */
function nodeCandidate(
  view: CameraBasis,
  camera: Camera,
  node: SimVec3,
  px: number,
  py: number,
): NodeCandidate | null {
  if (!(depthOf(view, node) > NEAR)) return null;
  const at = project(camera, node);
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;
  return {
    node,
    dist: Math.hypot(at.x - px, at.y - py),
    cam: distance(node, view.eye),
  };
}

/** Whether one node candidate beats another, in the order the spec fixes. */
function nodeBeats(a: NodeCandidate, b: NodeCandidate): boolean {
  let c = compare(a.dist, b.dist);
  if (c !== 0) return c < 0;
  c = compare(a.cam, b.cam);
  if (c !== 0) return c < 0;
  for (let axis = 0; axis < 3; axis++) {
    c = compare(a.node[axis], b.node[axis]);
    if (c !== 0) return c < 0;
  }
  return false;
}

/** The better of two node candidates, either of which may be missing. */
function bestNode(
  a: NodeCandidate | null,
  b: NodeCandidate | null,
): NodeCandidate | null {
  if (a === null) return b;
  if (b === null) return a;
  return nodeBeats(b, a) ? b : a;
}

/** The nearest node of a named set within `NODE_PICK_PX`, or none. */
function nearestOf(
  view: CameraBasis,
  camera: Camera,
  nodes: readonly SimVec3[],
  px: number,
  py: number,
): NodeCandidate | null {
  let best: NodeCandidate | null = null;
  for (const node of nodes) {
    const candidate = nodeCandidate(view, camera, node, px, py);
    if (candidate === null || candidate.dist > NODE_PICK_PX) continue;
    best = bestNode(best, candidate);
  }
  return best;
}

/** The first lattice coordinate at or above a bound. */
const firstNode = (bound: number): number =>
  Math.ceil(bound / LATTICE_PITCH) * LATTICE_PITCH;

/**
 * The node a click takes: every lattice node in the envelope standing in front
 * of the camera, projected to the stage, nearest within `NODE_PICK_PX`
 * (`specs/controls.md`).
 */
function pickNodeIn(
  view: CameraBasis,
  camera: Camera,
  envelope: Box,
  px: number,
  py: number,
): NodeCandidate | null {
  let best: NodeCandidate | null = null;
  for (
    let x = firstNode(envelope.min[0]);
    x <= envelope.max[0];
    x += LATTICE_PITCH
  ) {
    for (
      let y = firstNode(envelope.min[1]);
      y <= envelope.max[1];
      y += LATTICE_PITCH
    ) {
      for (
        let z = firstNode(envelope.min[2]);
        z <= envelope.max[2];
        z += LATTICE_PITCH
      ) {
        const candidate = nodeCandidate(view, camera, [x, y, z], px, py);
        if (candidate === null || candidate.dist > NODE_PICK_PX) continue;
        best = bestNode(best, candidate);
      }
    }
  }
  return best;
}

/** A segment cut back to the part of it that stands in front of the camera. */
interface FrontSegment {
  readonly a: SimVec3;
  readonly b: SimVec3;
  readonly depthA: number;
  readonly depthB: number;
}

function clipToFront(
  view: CameraBasis,
  a: SimVec3,
  b: SimVec3,
): FrontSegment | null {
  const depthA = depthOf(view, a);
  const depthB = depthOf(view, b);
  if (depthA < NEAR && depthB < NEAR) return null;
  if (depthA < NEAR) {
    const f = (NEAR - depthA) / (depthB - depthA);
    return { a: add(a, scale(sub(b, a), f)), b, depthA: NEAR, depthB };
  }
  if (depthB < NEAR) {
    const f = (NEAR - depthB) / (depthA - depthB);
    return { a, b: add(b, scale(sub(a, b), f)), depthA, depthB: NEAR };
  }
  return { a, b, depthA, depthB };
}

/**
 * A member's candidacy: its projected segment's distance from the click, and
 * where on the member the nearest point of that segment lies, which is what
 * breaks a tie. The screen parameter is carried back to the segment through the
 * perspective, so the point named is the one drawn under the pointer.
 */
function memberCandidate(
  view: CameraBasis,
  camera: Camera,
  member: SimMember,
  px: number,
  py: number,
): MemberCandidate | null {
  const front = clipToFront(view, member.a, member.b);
  if (front === null) return null;
  const pa = project(camera, front.a);
  const pb = project(camera, front.b);
  if (
    !Number.isFinite(pa.x) ||
    !Number.isFinite(pa.y) ||
    !Number.isFinite(pb.x) ||
    !Number.isFinite(pb.y)
  ) {
    return null;
  }
  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const len2 = dx * dx + dy * dy;
  const raw = len2 === 0 ? 0 : ((px - pa.x) * dx + (py - pa.y) * dy) / len2;
  const s = Math.min(1, Math.max(0, raw));
  const denominator = front.depthB + s * (front.depthA - front.depthB);
  const t = denominator === 0 ? s : (s * front.depthA) / denominator;
  const on = add(
    front.a,
    scale(sub(front.b, front.a), Math.min(1, Math.max(0, t))),
  );
  return {
    id: member.id,
    dist: Math.hypot(pa.x + s * dx - px, pa.y + s * dy - py),
    cam: distance(on, view.eye),
  };
}

/** Whether one member candidate beats another (`specs/controls.md`). */
function memberBeats(a: MemberCandidate, b: MemberCandidate): boolean {
  let c = compare(a.dist, b.dist);
  if (c !== 0) return c < 0;
  c = compare(a.cam, b.cam);
  if (c !== 0) return c < 0;
  return a.id < b.id;
}

/** The nearest member's projected segment within `MEMBER_PICK_PX`, or none. */
function pickMemberIn(
  view: CameraBasis,
  camera: Camera,
  members: readonly SimMember[],
  px: number,
  py: number,
): MemberCandidate | null {
  let best: MemberCandidate | null = null;
  for (const member of members) {
    const candidate = memberCandidate(view, camera, member, px, py);
    if (candidate === null || candidate.dist > MEMBER_PICK_PX) continue;
    if (best === null || memberBeats(candidate, best)) best = candidate;
  }
  return best;
}

/**
 * The node and the member a click at the pointer's current position would take,
 * by the pick radii and the tie-breaks `specs/controls.md` fixes. Both are
 * `null` on every screen but `build`, and wherever nothing is in range. It is a
 * pure reading: `snapshot().pick` is exactly this.
 */
export function pick(state: GantryState): Pick {
  if (state.screen !== "build") return { node: null, member: null };
  const view = cameraBasis(state.camera);
  const { x, y } = state.pointer;
  const node = pickNodeIn(
    view,
    state.camera,
    currentSite(state).envelope,
    x,
    y,
  );
  const member = pickMemberIn(
    view,
    state.camera,
    currentStructure(state).members.map(simMember),
    x,
    y,
  );
  return {
    node: node === null ? null : point(node.node),
    member: member === null ? null : member.id,
  };
}

// ---- Writing the structure -------------------------------------------------

/** Put a structure on the open site, touching nothing else. */
function putStructure(state: GantryState, structure: Structure): void {
  state.sites[state.siteIndex].structure = structure;
}

/**
 * Put a changed structure on the open site. The check result stands only until
 * the structure or the tape changes (`specs/structure.md`), and this is the
 * structure half of that.
 */
function withStructure(state: GantryState, structure: Structure): void {
  putStructure(state, structure);
  state.checkResult = null;
}

/**
 * Land one structure-changing edit: the structure as it stood joins the undo
 * history, oldest first, and the next one takes its place.
 */
function commit(state: GantryState, structure: Structure): void {
  state.history.push(copyStructure(currentStructure(state)));
  withStructure(state, structure);
}

/** The open structure with some fields replaced, the rest copied shallowly. */
const edited = (
  state: GantryState,
  changes: Partial<Structure>,
): Structure => ({ ...currentStructure(state), ...changes });

/** Whether a node carries a counterweight, which the counterweight tool reads. */
export const carriesCounterweight = (
  state: GantryState,
  node: SimVec3,
): boolean =>
  currentStructure(state).counterweights.some(
    (cw) => nodeKey(triple(cw)) === nodeKey(node),
  );

// ---- The edits -------------------------------------------------------------

/**
 * Place a member between two lattice nodes, under every rule
 * `specs/structure.md` lists. The member takes the structure's `nextMemberId`,
 * which advances by one, and the edit pushes the undo history.
 */
export function addMember(
  state: GantryState,
  a: SimVec3,
  b: SimVec3,
  material: Material,
): EditOutcome {
  const structure = currentStructure(state);
  const refusal = checkMemberPlacement(
    currentSite(state),
    simStructure(structure),
    a,
    b,
    material,
  );
  if (refusal !== null) return refused(refusal);
  commit(
    state,
    edited(state, {
      members: [
        ...structure.members,
        { id: structure.nextMemberId, a: point(a), b: point(b), material },
      ],
      nextMemberId: structure.nextMemberId + 1,
    }),
  );
  return { cue: "place", refusal: null };
}

/**
 * Remove the member carrying that id. Removal is always allowed, and no removal
 * gives an id back.
 */
export function removeMember(state: GantryState, id: number): EditOutcome {
  const structure = currentStructure(state);
  const members = structure.members.filter((m) => m.id !== id);
  if (members.length === structure.members.length) return unchanged();
  commit(state, edited(state, { members }));
  return { cue: "delete", refusal: null };
}

/** Place the slew ring by its base corner, under the ring rules. */
export function setRing(state: GantryState, corner: SimVec3): EditOutcome {
  const refusal = checkRingPlacement(
    currentSite(state),
    simStructure(currentStructure(state)),
    corner,
  );
  if (refusal !== null) return refused(refusal);
  commit(state, edited(state, { ring: { corner: point(corner) } }));
  return { cue: "place", refusal: null };
}

/**
 * Remove the ring. On a crane carrying none this is a silent refusal: it
 * changes nothing and pushes no history.
 */
export function clearRing(state: GantryState): EditOutcome {
  if (currentStructure(state).ring === null) return unchanged();
  commit(state, edited(state, { ring: null }));
  return { cue: "delete", refusal: null };
}

/** Place a counterweight on a lattice node, under the counterweight rules. */
export function addCounterweight(
  state: GantryState,
  node: SimVec3,
): EditOutcome {
  const structure = currentStructure(state);
  const refusal = checkCounterweightPlacement(
    currentSite(state),
    simStructure(structure),
    node,
  );
  if (refusal !== null) return refused(refusal);
  commit(
    state,
    edited(state, {
      counterweights: [...structure.counterweights, point(node)],
    }),
  );
  return { cue: "place", refusal: null };
}

/**
 * Remove the counterweight on a lattice node. On a node carrying none this is a
 * silent refusal: it changes nothing and pushes no history.
 */
export function removeCounterweight(
  state: GantryState,
  node: SimVec3,
): EditOutcome {
  const structure = currentStructure(state);
  const key = nodeKey(node);
  const counterweights = structure.counterweights.filter(
    (cw) => nodeKey(triple(cw)) !== key,
  );
  if (counterweights.length === structure.counterweights.length) {
    return unchanged();
  }
  commit(state, edited(state, { counterweights }));
  return { cue: "delete", refusal: null };
}

/**
 * Empty the open site's structure: every member, the ring, and every
 * counterweight go, `nextMemberId` returns to `0` whether or not anything went,
 * and the undo history is pushed exactly as one edit pushes it. On a structure
 * that is already empty it removes nothing and pushes no history
 * (`specs/instrumentation.md`).
 */
export function clearStructure(state: GantryState): EditOutcome {
  const structure = currentStructure(state);
  const bare =
    structure.members.length === 0 &&
    structure.ring === null &&
    structure.counterweights.length === 0;
  if (bare) {
    // Nothing goes, so no history is pushed, nothing is removed, and the check
    // result on screen still describes the structure it was taken on. The id
    // still returns to `0`: that happens whether or not anything went.
    if (structure.nextMemberId !== 0) putStructure(state, emptyStructure());
    return unchanged();
  }
  commit(state, emptyStructure());
  return { cue: "delete", refusal: null };
}

/**
 * Reverse the most recent structure-changing edit, as far back as the site was
 * opened. With an empty history it changes nothing. An undone placement gives
 * no id back (`specs/structure.md`), and every undo raises the `delete` cue.
 */
export function undo(state: GantryState): EditOutcome {
  const restored = state.history.pop();
  if (restored === undefined) return unchanged();
  // The ids climb with every member placed and fall only when the structure is
  // emptied whole, so an undo never hands one back: it takes the higher of the
  // two, which is the current one after a placement and the stored one after a
  // `clearStructure`, and members stay uniquely identified either way.
  restored.nextMemberId = Math.max(
    currentStructure(state).nextMemberId,
    restored.nextMemberId,
  );
  withStructure(state, restored);
  return { cue: "delete", refusal: null };
}

/**
 * Run the static check of `specs/structure.md` and leave the result showing on
 * the build screen — what the `check` action does. The pure computation is
 * `staticCheck` from `src/sim`; this is the one place that displays it.
 */
export function showCheck(state: GantryState): void {
  const result = staticCheck(
    currentSite(state),
    simStructure(currentStructure(state)),
    currentProgram(state),
  );
  state.checkResult = {
    issues: [...result.issues],
    cost: result.cost,
    budget: result.budget,
    stable: result.stable,
    members: result.members.map((m) => ({
      id: m.id,
      force: m.force,
      utilization: m.utilization,
    })),
  };
}

// ---- The tools -------------------------------------------------------------

/** What the delete tool found under the click, in the order it prefers them. */
export type DeleteTarget =
  | { readonly kind: "member"; readonly id: number }
  | { readonly kind: "counterweight"; readonly node: SimVec3 }
  | { readonly kind: "ring" };

/**
 * What a delete click takes: the nearest in screen distance of a member within
 * `MEMBER_PICK_PX`, a counterweight within `NODE_PICK_PX` of its node, or the
 * ring within `NODE_PICK_PX` of any of its eight flange nodes. A tie goes to
 * the member, then the counterweight, then the ring (`specs/controls.md`).
 */
export function deleteTarget(state: GantryState): DeleteTarget | null {
  const view = cameraBasis(state.camera);
  const structure = simStructure(currentStructure(state));
  const { x, y } = state.pointer;
  const member = pickMemberIn(view, state.camera, structure.members, x, y);
  const counterweight = nearestOf(
    view,
    state.camera,
    structure.counterweights,
    x,
    y,
  );
  const flanges = flangeNodes(structure.ring);
  const ring = nearestOf(
    view,
    state.camera,
    [...flanges.bottom, ...flanges.top],
    x,
    y,
  );

  let best: DeleteTarget | null = null;
  let bestDist = Infinity;
  // Tried in the tie order, and each takes the lead only on a strictly nearer
  // distance, so a tie is left with the kind tried before it.
  if (member !== null) {
    best = { kind: "member", id: member.id };
    bestDist = member.dist;
  }
  if (counterweight !== null && compare(counterweight.dist, bestDist) < 0) {
    best = { kind: "counterweight", node: counterweight.node };
    bestDist = counterweight.dist;
  }
  if (ring !== null && compare(ring.dist, bestDist) < 0) {
    best = { kind: "ring" };
  }
  return best;
}

/**
 * The strut, cable, and rail tools: the first click holds a node pending, the
 * second places the member between them. A second click on the pending node
 * itself clears it without placing, and a second click the rules refuse leaves
 * it held, so a slip does not cost the selection (`specs/controls.md`).
 */
export function applyMemberTool(
  state: GantryState,
  material: Material,
  node: SimVec3 | null,
): EditOutcome {
  if (node === null) return unchanged();
  const pending = state.pendingNode;
  if (pending === null) {
    setPendingNode(state, point(node));
    return unchanged();
  }
  if (nodeKey(triple(pending)) === nodeKey(node)) {
    clearPendingNode(state);
    return unchanged();
  }
  const outcome = addMember(state, triple(pending), node, material);
  if (outcome.refusal !== null) return outcome;
  clearPendingNode(state);
  return outcome;
}

/**
 * Apply a click at the pointer's current position on the build screen: the
 * selected tool's behaviour over what `pick` finds (`specs/controls.md`). A
 * click with no candidate in range, and a click on any other screen, changes
 * nothing.
 */
export function applyClick(state: GantryState): EditOutcome {
  if (state.screen !== "build") return unchanged();
  const view = cameraBasis(state.camera);
  const { x, y } = state.pointer;
  const node = pickNodeIn(
    view,
    state.camera,
    currentSite(state).envelope,
    x,
    y,
  );
  const picked = node === null ? null : node.node;

  switch (state.tool) {
    case "strut":
    case "cable":
    case "rail":
      return applyMemberTool(state, state.tool, picked);
    case "ring":
      // The ring, counterweight, and delete tools neither read the pending node
      // nor clear it: a click under one of them does what its bullet says and
      // leaves it held (`specs/controls.md`).
      return picked === null ? unchanged() : setRing(state, picked);
    case "counterweight":
      if (picked === null) return unchanged();
      return carriesCounterweight(state, picked)
        ? removeCounterweight(state, picked)
        : addCounterweight(state, picked);
    case "delete": {
      const target = deleteTarget(state);
      if (target === null) return unchanged();
      if (target.kind === "member") return removeMember(state, target.id);
      if (target.kind === "counterweight") {
        return removeCounterweight(state, target.node);
      }
      return clearRing(state);
    }
  }
}
