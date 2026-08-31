// Facet — the pointer, resolved: targets first, then the board.
//
// `specs/controls.md` gives every screen a set of pointer targets and gives the
// `playing` screen the whole of the rest of the stage. So one press is resolved
// in one order: if it lands in a target, the target rules apply and the board
// never sees it; otherwise, on `playing`, the board's own tables decide.
//
// The board's tables are the heart of it, and they read the way a hand does. A
// press takes hold of a gem, `state.selection` is the gem being held, and
// `state.offer` is the neighbor it is currently being offered into. NOTHING
// reaches the move rules until the pointer is released: a player who carries a
// gem onto a neighbor and then back where it started has withdrawn the offer,
// and the release plays nothing. That is what makes a move something a player
// can see before they commit to it.
//
// A move with nothing pressed is a hover, which highlights the target under it.
// That is what a mouse gives for free and a finger never produces, so the press
// highlights too: a finger has no hover, and the press is what tells a player
// which item their release will take.
//
// Nothing here touches a DOM event. The runtime layer above reports a pointer
// position in logical stage units, the press and release edges, and which of
// `mouse`, `pen`, and `touch` drove them, and this module says what the game
// does with them.

import { orthogonallyAdjacent, sameCell, targetCell } from "./board";
import { requestSwap } from "./chain";
import { confirmMenu, goBack, pauseGame } from "./flow";
import { menuIndexOf, targetAt } from "./targets";
import {
  NO_EVENTS,
  quiet,
  type Cell,
  type FacetState,
  type PointerDevice,
  type Stepped,
} from "./state";

// ---- The board's three tables (specs/controls.md) ------------------------

/**
 * The press table, whose five rows are evaluated in order and whose first
 * matching row applies:
 *
 *   1. any cell, while nothing is selected — selects it, with no offer;
 *   2. the selected cell — keeps it selected and withdraws any standing offer,
 *      so the gem is taken hold of again where it started;
 *   3. a cell orthogonally adjacent to the selection — offers the held gem
 *      into it;
 *   4. any other cell — moves the selection there, with no offer;
 *   5. no cell at all — clears the selection and any offer.
 *
 * Rows `1` and `4` are the two that make a cell the selection, so they are the
 * two that raise `select`.
 */
export function pressCell(state: FacetState, cell: Cell | null): Stepped {
  if (!cell) return quiet({ ...state, selection: null, offer: null });

  const hold = (): Stepped => ({
    state: { ...state, selection: cell, offer: null },
    events: { ...NO_EVENTS, select: true },
  });

  const selection = state.selection;
  if (!selection) return hold();
  if (sameCell(selection, cell)) return quiet({ ...state, offer: null });
  if (orthogonallyAdjacent(selection, cell)) {
    return quiet({ ...state, offer: cell });
  }
  return hold();
}

/**
 * The move table, read against the selected cell while the pointer is held
 * down: back onto the selected cell withdraws the offer, onto a neighbor of it
 * offers there, and anything else changes nothing. It raises no cue, because
 * an offer is a proposal rather than a move.
 */
export function offerCell(state: FacetState, cell: Cell | null): FacetState {
  const selection = state.selection;
  if (!selection || !cell) return state;
  if (sameCell(selection, cell)) return { ...state, offer: null };
  if (orthogonallyAdjacent(selection, cell)) return { ...state, offer: cell };
  return state;
}

/**
 * The release table: a release with an offer standing requests that swap and
 * clears both the offer and the selection, and a release with none leaves the
 * selection and the board exactly as they stand.
 *
 * This is the only path from the board into the move rules, so a move is played
 * by a release and by nothing else.
 */
export function releaseBoard(state: FacetState): Stepped {
  const selection = state.selection;
  const offer = state.offer;
  if (!selection || !offer) return quiet(state);
  const swapped = requestSwap(state, { a: selection, b: offer });
  return {
    state: { ...swapped.state, selection: null, offer: null },
    events: swapped.events,
  };
}

// ---- The screen's targets (specs/controls.md) ----------------------------

/** The highlight a target moves, which is the menu item a `menu-<i>` names. */
function highlight(state: FacetState, id: string): FacetState {
  const index = menuIndexOf(id);
  return index === null ? state : { ...state, menuIndex: index };
}

/**
 * A target taken, which does exactly what the same choice does from the
 * keyboard: `menu-<i>` is `confirm` with the highlight at `i`, `back` is the
 * `back` action on that screen, and `pause` is the `pause` action.
 */
function take(state: FacetState, id: string): FacetState {
  if (id === "back") return goBack(state);
  if (id === "pause") return pauseGame(state);
  const index = menuIndexOf(id);
  if (index === null) return state;
  return confirmMenu({ ...state, menuIndex: index });
}

// ---- The pointer ---------------------------------------------------------

/**
 * A press. The pointer is recorded whatever the screen, because the snapshot
 * reports it on every screen.
 *
 * A press inside a target moves the highlight and arms that target, whatever
 * lies behind it, so the `pause` control on `playing` never takes hold of a
 * gem. A press outside every target arms nothing, and on `playing` it runs the
 * press table above — including its last row, which is the press farther than
 * `GEM_HIT_R` from every cell center that a validator uses to unlock audio
 * without disturbing the board.
 */
export function pointerDown(
  state: FacetState,
  x: number,
  y: number,
  device: PointerDevice = "mouse",
): Stepped {
  const pressed: FacetState = {
    ...state,
    pointer: { x, y, down: true, device },
  };
  const target = targetAt(pressed.screen, x, y);
  if (target) {
    return quiet({ ...highlight(pressed, target.id), armedTarget: target.id });
  }

  const disarmed: FacetState = { ...pressed, armedTarget: null };
  if (disarmed.screen !== "playing") return quiet(disarmed);
  return pressCell(disarmed, targetCell(disarmed.board, x, y));
}

/**
 * A move. With a target armed nothing changes but where the pointer is, since
 * only the release decides what is taken. With nothing pressed the move is a
 * hover, which highlights the `menu-<i>` it is over. With the pointer held down
 * on the board, the move table offers and withdraws.
 */
export function pointerMove(
  state: FacetState,
  x: number,
  y: number,
  device: PointerDevice = "mouse",
): Stepped {
  const moved: FacetState = {
    ...state,
    pointer: { x, y, down: state.pointer.down, device },
  };
  if (moved.armedTarget !== null) return quiet(moved);

  const target = targetAt(moved.screen, x, y);
  if (!moved.pointer.down) {
    return quiet(target === null ? moved : highlight(moved, target.id));
  }
  if (moved.screen !== "playing" || target !== null) return quiet(moved);
  return quiet(offerCell(moved, targetCell(moved.board, x, y)));
}

/**
 * A release. It takes the armed target only when it lands inside that same
 * target; a release anywhere else disarms it and takes nothing. With nothing
 * armed, a release on `playing` is what plays a move.
 */
export function pointerUp(
  state: FacetState,
  device: PointerDevice = "mouse",
): Stepped {
  const lifted: FacetState = {
    ...state,
    pointer: { ...state.pointer, down: false, device },
    armedTarget: null,
  };

  const armed = state.armedTarget;
  if (armed !== null) {
    const under = targetAt(lifted.screen, lifted.pointer.x, lifted.pointer.y);
    return quiet(under?.id === armed ? take(lifted, armed) : lifted);
  }

  if (lifted.screen !== "playing") return quiet(lifted);
  return releaseBoard(lifted);
}
