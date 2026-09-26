// The build tools: what a click does with the selected one
// (`specs/controls.md`).
//
// The edits themselves are written, in `src/edits.ts`, and so is the picking,
// in `src/pick.ts`; what is here is the tool behaviour over a pick — the
// pending first node the member tools hold, the ring and counterweight tools,
// and the delete tool's tie order.
//
// Everything is pure: it takes the state and returns the next one, with the
// refusal named where the rules refused an edit so the build screen can show
// why a click did nothing, and the cue an edit raised already queued on
// `state.cues` for the next update to play.

import { fromSimVec, samePoint, type ReadonlyPoint } from "./convert";
import {
  addCounterweight,
  addMember,
  carriesCounterweight,
  clearRing,
  removeCounterweight,
  removeMember,
  setRing,
  type EditOutcome,
} from "./edits";
import type { GantryState, MaterialName, Vec3 } from "./game";
import {
  compare,
  currentEnvelope,
  nearestOf,
  pickMemberIn,
  pickNodeIn,
  viewBasis,
  type MemberCandidate,
} from "./pick";
import { flangeNodes } from "./sim";
import {
  clearPendingNode,
  currentSimStructure,
  currentStructure,
  setPendingNode,
} from "./state";
import type { CameraBasis } from "./project";

/** An outcome that changed nothing and raised nothing. */
const unchanged = (state: GantryState): EditOutcome => ({
  state,
  refusal: null,
});

/** What the delete tool found under the click, in the order it prefers them. */
type DeleteTarget =
  | { readonly kind: "member"; readonly id: number }
  | { readonly kind: "counterweight"; readonly node: Vec3 }
  | { readonly kind: "ring" };

/**
 * What a delete click takes: the nearest in screen distance of a member within
 * `MEMBER_PICK_PX`, a counterweight within `NODE_PICK_PX` of its node, or the
 * ring within `NODE_PICK_PX` of any of its eight flange nodes. A tie goes to
 * the member, then the counterweight, then the ring (`specs/controls.md`).
 */
function deleteTarget(
  state: GantryState,
  basis: CameraBasis,
  member: MemberCandidate | null,
): DeleteTarget | null {
  const camera = { ...state.camera };
  const { x, y } = state.pointer;
  const counterweights: readonly ReadonlyPoint[] =
    currentStructure(state).counterweights;
  const counterweight = nearestOf(basis, camera, counterweights, x, y);
  const flanges = flangeNodes(currentSimStructure(state).ring);
  const ring = nearestOf(
    basis,
    camera,
    [...flanges.bottom, ...flanges.top].map(fromSimVec),
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
function applyMemberTool(
  state: GantryState,
  material: MaterialName,
  node: Vec3 | null,
): EditOutcome {
  if (node === null) return unchanged(state);
  const pending = state.pendingNode;
  if (pending === null) return unchanged(setPendingNode(state, node));
  if (samePoint(pending, node)) return unchanged(clearPendingNode(state));
  const outcome = addMember(state, pending, node, material);
  if (outcome.refusal !== null) return outcome;
  return { ...outcome, state: clearPendingNode(outcome.state) };
}

/**
 * Apply a click at the pointer's current position on the build screen: the
 * selected tool's behaviour over what `pick` finds (`specs/controls.md`). A
 * click with no candidate in range, and a click on any other screen, changes
 * nothing.
 */
export function applyClick(state: GantryState): EditOutcome {
  if (state.screen !== "build") return unchanged(state);
  const camera = { ...state.camera };
  const basis = viewBasis(camera);
  const { x, y } = state.pointer;
  const node = pickNodeIn(basis, camera, currentEnvelope(state), x, y);
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
      return picked === null ? unchanged(state) : setRing(state, picked);
    case "counterweight":
      if (picked === null) return unchanged(state);
      return carriesCounterweight(state, picked)
        ? removeCounterweight(state, picked)
        : addCounterweight(state, picked);
    case "delete": {
      const member = pickMemberIn(
        basis,
        camera,
        currentStructure(state).members,
        x,
        y,
      );
      const target = deleteTarget(state, basis, member);
      if (target === null) return unchanged(state);
      if (target.kind === "member") return removeMember(state, target.id);
      if (target.kind === "counterweight") {
        return removeCounterweight(state, target.node);
      }
      return clearRing(state);
    }
  }
}
