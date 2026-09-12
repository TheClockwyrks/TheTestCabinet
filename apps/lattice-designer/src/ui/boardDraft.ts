// The board-size draft: the rules deciding what the W/H pair would do, and what a
// resize has to ask before it does it.
//
// The board size is the one value in this tool whose change RESTRUCTURES the design,
// and the tool has no undo. Committing it from a keystroke was destructive for the
// obvious reason — replacing a width of 12 with 64 types "6" first, and 6 is a legal
// width — but committing it on blur is the same defect wearing a coat: leaving the
// field is not a decision to resize, it is a decision to stop typing. Tabbing to H,
// clicking the canvas, or alt-tabbing away all applied the resize.
//
// So the fields here are a DRAFT and nothing else. Typing in them, leaving them, and
// abandoning them change nothing at all; an explicit Apply is the only thing that
// reaches the design, and Apply asks first when it would cost the user components.
//
// The rules live in this module, free of JSX, for the same reason `numberField.ts`
// does: the interesting part is a decision, and a decision is worth testing without
// a DOM to drive it. The reading of a single field is still `readNumberField`'s job
// (the console's `numberFieldRules`, aliased as `@numeric`) — this only composes the
// two readings into an answer about the pair.

import { readNumberField, type NumberFieldBounds } from "@numeric";
import {
  MAX_BOARD_DIM,
  MIN_BOARD_DIM,
  type Design,
  type ResizeResult,
} from "../model";

type Grid = Design["grid"];

/** The text the two fields hold. Not a size — text, whatever was typed. */
export interface BoardDraft {
  width: string;
  height: string;
}

/** What the pair currently amounts to. */
export interface BoardDraftState {
  /** True when either field says something other than the board's own size. */
  pending: boolean;
  /** The size Apply would commit, or `null` when it would commit nothing. */
  apply: Grid | null;
  /** Why Apply is disabled, or `null` when it is enabled. */
  blocked: string | null;
}

/** The bounds one dimension field declares, named for the sentence it produces. */
export function boardDimBounds(label: string): NumberFieldBounds {
  return {
    min: MIN_BOARD_DIM,
    max: MAX_BOARD_DIM,
    integer: true,
    label,
  };
}

/** The draft a pair of fields starts from: the board, as text. */
export function boardDraftOf(grid: Grid): BoardDraft {
  return { width: String(grid.width), height: String(grid.height) };
}

/**
 * Read the pair against the board it is being typed over.
 *
 * `pending` is deliberately a comparison of TEXT, not of values: a field saying
 * `64` over a board of 12, and a field saying nothing usable at all, are both states
 * in which the control is not showing the truth, and both have to be visible as
 * such. `apply` is the narrower question — a size, in range, that is not the size
 * the board already is.
 */
export function readBoardDraft(draft: BoardDraft, grid: Grid): BoardDraftState {
  const pending =
    draft.width !== String(grid.width) || draft.height !== String(grid.height);

  const width = readNumberField(draft.width, boardDimBounds("Board width"));
  if (!width.valid || width.value === undefined) {
    return { pending, apply: null, blocked: width.message };
  }
  const height = readNumberField(draft.height, boardDimBounds("Board height"));
  if (!height.valid || height.value === undefined) {
    return { pending, apply: null, blocked: height.message };
  }
  if (width.value === grid.width && height.value === grid.height) {
    return {
      pending,
      apply: null,
      blocked: `The board is already ${grid.width}×${grid.height}.`,
    };
  }
  return {
    pending,
    apply: { width: width.value, height: height.value },
    blocked: null,
  };
}

/** The question a resize has to answer before it runs. */
export interface ResizeQuestion {
  title: string;
  message: string;
  /** The consequences, one per line, for the dialog's detail region. */
  details: string[];
  confirmLabel: string;
}

/**
 * What a resize would cost, as the question to ask — or `null` when it costs
 * nothing and so must not interrupt anyone.
 *
 * `plan` is the result of running `resizeBoard`, which is a pure function: the plan
 * is computed from the current design and discarded if the answer is no, so nothing
 * is mutated in order to find out what the resize would do.
 *
 * The wording has to carry the whole cost, which is why this is a modal and not a
 * `window.confirm()`. A set-aside component is not deleted — it comes back if the
 * board grows over it again — but it IS off the board, out of the simulation, and
 * NOT written when the file is saved, and a user who says yes without being told
 * that can save a file with half their factory missing from it.
 */
export function resizeQuestion(
  to: Grid,
  plan: ResizeResult,
): ResizeQuestion | null {
  if (plan.setAside === 0) return null;
  const n = plan.setAside;
  const them = n === 1 ? "it" : "them";
  const details = [
    `${count(n, "component")} no longer fit inside ${to.width}×${to.height} and would be taken off the board.`,
    `They are NOT deleted — growing the board back over ${them} puts ${them} back, in place and in order.`,
    `They are NOT part of the design while they are set aside: the simulation does not run ${them}, and Save and Export do not write ${them}.`,
  ];
  if (plan.restored > 0) {
    details.push(
      `${count(plan.restored, "component")} previously set aside would come back onto the board.`,
    );
  }
  return {
    title: `Resize to ${to.width}×${to.height}?`,
    message: `${count(n, "component")} would be set aside — off the board, out of the simulation, and left out of the saved file until the board is big enough for ${them} again.`,
    details,
    confirmLabel: `Resize and set ${them} aside`,
  };
}

/** `1 component` / `3 components`. */
export function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
