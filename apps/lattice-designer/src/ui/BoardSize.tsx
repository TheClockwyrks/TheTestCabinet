// The board-size control: two staged fields, an explicit Apply, and the presets.
//
// This is the only control in the designer whose commit restructures the design, and
// the tool has no undo, so the input is decoupled from the action entirely. W and H
// are a DRAFT: typing in them, tabbing out of them, clicking the canvas and walking
// away all change nothing whatsoever about the board. Apply is the action, Enter
// inside a field is that same action reached from the keyboard, and Escape puts the
// draft back to the board's real size.
//
// Because the fields can disagree with the board, they have to SAY so: while the
// draft differs, the group is marked staged and names both sizes, so "the board is
// 12 wide and the field says 64, and Apply is what closes that gap" is on screen
// rather than inferred. Apply is disabled when the draft is unreadable or names the
// size the board already is, and says which in its tooltip.
//
// The presets apply directly rather than loading the draft. A preset click is
// already the explicit, deliberate act the draft exists to require — there is no
// value being changed on the way past, no "6" typed en route to "64" — and making
// it take two gestures would be friction bought with nothing. What matters is that
// it is destructive under exactly the same conditions, so it goes through exactly
// the same `onApply`, and therefore the same confirmation. Applying (from either
// route) resyncs the fields to the board, so they never go on claiming a pending
// size that has already happened or been overtaken.

import { useState } from "react";
import { GRID_PRESETS, type Design } from "../model";
import {
  boardDimBounds,
  boardDraftOf,
  readBoardDraft,
  type BoardDraft,
} from "./boardDraft";
import { StagedNumberInput } from "./NumberInput";

interface BoardSizeProps {
  grid: Design["grid"];
  /**
   * Apply a size. The caller owns the destructive check: it plans the resize, asks
   * if the plan would set anything aside, and commits only on yes.
   */
  onApply: (width: number, height: number) => void;
}

export function BoardSize({ grid, onApply }: BoardSizeProps) {
  const { width, height } = grid;
  const [draft, setDraft] = useState<BoardDraft>(() => boardDraftOf(grid));

  // Resync whenever the board actually changes, whatever changed it — an Apply, a
  // preset, or a scenario being opened. Done DURING render rather than in an effect:
  // an effect lands a tick late, and anything typed in that gap is silently thrown
  // away when it finally runs.
  const [seen, setSeen] = useState<BoardDraft>(() => boardDraftOf(grid));
  const fresh = boardDraftOf({ width, height });
  if (seen.width !== fresh.width || seen.height !== fresh.height) {
    setSeen(fresh);
    setDraft(fresh);
  }

  const state = readBoardDraft(draft, grid);
  const submit = () => {
    if (state.apply) onApply(state.apply.width, state.apply.height);
  };
  const revert = () => setDraft(boardDraftOf(grid));

  return (
    <div
      className={state.pending ? "group board-size staged" : "group board-size"}
    >
      <label className="inline">
        W
        <StagedNumberInput
          {...boardDimBounds("Board width")}
          ariaLabel="Board width"
          title="The board’s width. Nothing happens until you press Apply."
          text={draft.width}
          onText={(raw) => setDraft((d) => ({ ...d, width: raw }))}
          onSubmit={submit}
          onRevert={revert}
        />
      </label>
      <label className="inline">
        H
        <StagedNumberInput
          {...boardDimBounds("Board height")}
          ariaLabel="Board height"
          title="The board’s height. Nothing happens until you press Apply."
          text={draft.height}
          onText={(raw) => setDraft((d) => ({ ...d, height: raw }))}
          onSubmit={submit}
          onRevert={revert}
        />
      </label>
      <button
        type="button"
        className="apply"
        disabled={state.apply === null}
        title={
          state.blocked ??
          `Resize the board from ${grid.width}×${grid.height} to ${state.apply?.width}×${state.apply?.height}. Anything that no longer fits is set aside, and you will be asked first.`
        }
        onClick={submit}
      >
        {state.apply ? "Apply •" : "Apply"}
      </button>
      {/* What the fields are claiming, versus what the board is. Announced, because
          the gap between the two is the whole reason this control is staged. */}
      <span className="board-pending" role="status">
        {!state.pending
          ? null
          : state.apply
            ? `not applied — board is ${grid.width}×${grid.height}, Apply makes it ${state.apply.width}×${state.apply.height}`
            : `not applied — ${state.blocked}`}
      </span>
      <div className="presets">
        {GRID_PRESETS.map((p) => {
          const active = grid.width === p.width && grid.height === p.height;
          return (
            <button
              key={p.name}
              type="button"
              className={active ? "preset active" : "preset"}
              title={`${p.name} scored grid: ${p.width}×${p.height}. Applies straight away — you are asked first if anything would be set aside.`}
              onClick={() => onApply(p.width, p.height)}
            >
              {p.name} {p.width}×{p.height}
            </button>
          );
        })}
      </div>
    </div>
  );
}
