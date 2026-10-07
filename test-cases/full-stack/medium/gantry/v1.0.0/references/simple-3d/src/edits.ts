// The structure editor's edits, as transitions.
//
// Every edit passes the rules of `specs/structure.md`, which are
// `src/sim/structure.ts`'s and are called rather than restated: a refused edit
// returns a state equal to the one handed in, with the rule that refused it
// named so the build screen can show why a click did nothing. Each edit that
// lands pushes the undo history exactly as one click pushes it, and raises its
// cue on the state for the next update to play (`specs/ui.md`).
//
// The tools that turn a pick into one of these edits are the editor's, in
// `src/editor.ts`; the tape editor's rules carry no structure rule, so they are
// plain transitions in `src/state.ts`.

import {
  copyPoint,
  copyStructure,
  emptyStructure,
  fromSimCheck,
  samePoint,
  thaw,
  toSimStructure,
  toSimVec,
  type ReadonlyPoint,
} from "./convert";
import type {
  GantryState,
  MaterialName,
  ReadonlyGantryState,
  Structure,
} from "./game";
import { raise, currentSite, currentSimStructure, currentTape } from "./state";
import {
  checkCounterweightPlacement,
  checkMemberPlacement,
  checkRingPlacement,
  staticCheck,
  type EditRefusal,
} from "./sim";

/**
 * What an edit did.
 *
 * `state` is the next state — equal to the state handed in when the edit was
 * refused. `refusal` names the rule that refused it, and is `null` when the
 * edit landed or when there was simply nothing to remove. The cue an edit
 * raises is already on `state.cues`.
 */
export interface EditOutcome {
  state: GantryState;
  refusal: EditRefusal | null;
}

/** An outcome that changed nothing and raised nothing. */
const unchanged = (state: GantryState): EditOutcome => ({
  state,
  refusal: null,
});

/** An outcome the rules refused. */
const refused = (state: GantryState, refusal: EditRefusal): EditOutcome => ({
  state,
  refusal,
});

/**
 * Land one structure-changing edit on a state the caller owns: the structure as
 * it stood joins the undo history, oldest first, the next one takes its place,
 * and the check result on screen — which stands only until the structure or the
 * tape changes (`specs/structure.md`) — goes.
 */
function commit(s: GantryState, structure: Structure): GantryState {
  s.history.push(copyStructure(s.sites[s.siteIndex].structure));
  s.sites[s.siteIndex].structure = structure;
  s.checkResult = null;
  return s;
}

/** The open structure of a state the caller owns. */
const openStructure = (s: GantryState): Structure =>
  s.sites[s.siteIndex].structure;

/**
 * Place a member between two lattice nodes, under every rule
 * `specs/structure.md` lists. The member takes the structure's `nextMemberId`,
 * which advances by one, and the edit pushes the undo history.
 */
export function addMember(
  state: ReadonlyGantryState,
  a: ReadonlyPoint,
  b: ReadonlyPoint,
  material: MaterialName,
): EditOutcome {
  const s = thaw(state);
  const refusal = checkMemberPlacement(
    currentSite(state),
    currentSimStructure(state),
    toSimVec(a),
    toSimVec(b),
    material,
  );
  if (refusal !== null) return refused(s, refusal);
  const structure = copyStructure(openStructure(s));
  structure.members.push({
    id: structure.nextMemberId,
    a: copyPoint(a),
    b: copyPoint(b),
    material,
  });
  structure.nextMemberId += 1;
  return unchanged(raise(commit(s, structure), "place", a));
}

/**
 * Remove the member carrying that id. Removal is always allowed, and no
 * removal gives an id back. An id the structure does not carry removes none.
 */
export function removeMember(
  state: ReadonlyGantryState,
  id: number,
): EditOutcome {
  const s = thaw(state);
  const structure = copyStructure(openStructure(s));
  const going = structure.members.find((m) => m.id === id);
  if (going === undefined) return unchanged(s);
  structure.members = structure.members.filter((m) => m.id !== id);
  return unchanged(raise(commit(s, structure), "delete", going.a));
}

/** Place the slew ring by its base corner, under the ring rules. */
export function setRing(
  state: ReadonlyGantryState,
  corner: ReadonlyPoint,
): EditOutcome {
  const s = thaw(state);
  const refusal = checkRingPlacement(
    currentSite(state),
    currentSimStructure(state),
    toSimVec(corner),
  );
  if (refusal !== null) return refused(s, refusal);
  const structure = copyStructure(openStructure(s));
  structure.ring = { corner: copyPoint(corner) };
  return unchanged(raise(commit(s, structure), "place", corner));
}

/**
 * Remove the ring. On a crane carrying none this is a silent refusal: it
 * changes nothing and pushes no history.
 */
export function clearRing(state: ReadonlyGantryState): EditOutcome {
  const s = thaw(state);
  const structure = copyStructure(openStructure(s));
  const going = structure.ring;
  if (going === null) return unchanged(s);
  structure.ring = null;
  return unchanged(raise(commit(s, structure), "delete", going.corner));
}

/** Place a counterweight on a lattice node, under the counterweight rules. */
export function addCounterweight(
  state: ReadonlyGantryState,
  node: ReadonlyPoint,
): EditOutcome {
  const s = thaw(state);
  const refusal = checkCounterweightPlacement(
    currentSite(state),
    currentSimStructure(state),
    toSimVec(node),
  );
  if (refusal !== null) return refused(s, refusal);
  const structure = copyStructure(openStructure(s));
  structure.counterweights.push(copyPoint(node));
  return unchanged(raise(commit(s, structure), "place", node));
}

/**
 * Remove the counterweight on a lattice node. On a node carrying none this is
 * a silent refusal: it changes nothing and pushes no history.
 */
export function removeCounterweight(
  state: ReadonlyGantryState,
  node: ReadonlyPoint,
): EditOutcome {
  const s = thaw(state);
  const structure = copyStructure(openStructure(s));
  const kept = structure.counterweights.filter((cw) => !samePoint(cw, node));
  if (kept.length === structure.counterweights.length) return unchanged(s);
  structure.counterweights = kept;
  return unchanged(raise(commit(s, structure), "delete", node));
}

/** Whether a node carries a counterweight. */
export const carriesCounterweight = (
  state: ReadonlyGantryState,
  node: ReadonlyPoint,
): boolean =>
  state.sites[state.siteIndex].structure.counterweights.some((cw) =>
    samePoint(cw, node),
  );

/**
 * Empty the open site's structure: every member, the ring, and every
 * counterweight go, `nextMemberId` returns to `0` whether or not anything
 * went, and the undo history is pushed exactly as one edit pushes it. On a
 * structure that is already empty it removes nothing and pushes no history
 * (`specs/instrumentation.md`).
 */
export function clearStructure(state: ReadonlyGantryState): EditOutcome {
  const s = thaw(state);
  const structure = openStructure(s);
  const bare =
    structure.members.length === 0 &&
    structure.ring === null &&
    structure.counterweights.length === 0;
  if (bare) {
    // Nothing goes, so no history is pushed, nothing is removed, and the check
    // result on screen still describes the structure it was taken on. The id
    // still returns to `0`: that happens whether or not anything went.
    if (structure.nextMemberId === 0) return unchanged(s);
    s.sites[s.siteIndex].structure = emptyStructure();
    return unchanged(s);
  }
  return unchanged(raise(commit(s, emptyStructure()), "delete"));
}

/**
 * Reverse the most recent structure-changing edit, as far back as the site was
 * opened. With an empty history it changes nothing. An undone placement gives
 * no id back (`specs/structure.md`), and every undo raises the `delete` cue.
 */
export function undo(state: ReadonlyGantryState): EditOutcome {
  const s = thaw(state);
  const restored = s.history.pop();
  if (restored === undefined) return unchanged(s);
  // The ids climb with every member placed and fall only when the structure is
  // emptied whole, so an undo never hands one back: it takes the higher of the
  // two, which is the current one after a placement and the stored one after a
  // `clearStructure`, and members stay uniquely identified either way.
  restored.nextMemberId = Math.max(
    openStructure(s).nextMemberId,
    restored.nextMemberId,
  );
  s.sites[s.siteIndex].structure = restored;
  s.checkResult = null;
  return unchanged(raise(s, "delete"));
}

/**
 * Run the static check of `specs/structure.md` and leave the result showing on
 * the build screen — what the `check` action does. The pure computation is
 * `staticCheck` from `src/sim`; this is the one place that displays it.
 */
export function showCheck(state: ReadonlyGantryState): GantryState {
  const s = thaw(state);
  s.checkResult = fromSimCheck(
    staticCheck(
      currentSite(state),
      toSimStructure(state.sites[state.siteIndex].structure),
      currentTape(state),
    ),
  );
  return s;
}
