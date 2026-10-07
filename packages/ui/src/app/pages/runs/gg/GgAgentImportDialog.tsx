import type { GgSavedAgent } from "@clockwyrks/run-record/gg";
import { Dialog } from "../../../../primitives/Dialog";
import { agentModeLabel } from "./ggAgentLibrary";
import gg from "./GgConfigEditor.module.scss";

/**
 * Pick one saved agent to import into the configuration being edited.
 *
 * A dialog rather than a `<select>` beside the button, because the choice needs more
 * than a name to make: two library entries called "reviewer" are told apart by what they
 * are *for*, and an `<option>` can carry one line of unstyled text and nothing else. Each
 * row here is the entry's name over its own one-line note, so the list reads the way the
 * library page it came from reads.
 *
 * Picking is the whole interaction — a row imports and closes, and there is no confirm
 * step. The two controls this replaces existed so that choosing from the list was not
 * itself the act of adding; a modal already separates the two, since opening the list is
 * the deliberate act and Cancel leaves with nothing done.
 */
export function GgAgentImportDialog({
  savedAgents,
  onPick,
  onDismiss,
}: {
  savedAgents: ReadonlyArray<GgSavedAgent>;
  onPick: (saved: GgSavedAgent) => void;
  onDismiss: () => void;
}) {
  return (
    <Dialog
      title="Import a saved agent"
      onDismiss={onDismiss}
      details={
        <ul className={gg.importList}>
          {savedAgents.map((saved) => (
            <li key={saved.id}>
              <button
                type="button"
                className={gg.importOption}
                onClick={() => onPick(saved)}
              >
                <span className={gg.importOptionName}>
                  {saved.name || "unnamed"}
                </span>
                {/* The entry's own note, capped to one line: a library listed at two
                    lines a row is one an operator scrolls rather than scans. An entry
                    with no note says what type of agent it is instead, which is the
                    next most useful thing about it and keeps every row the same
                    height. */}
                <span className={gg.importOptionNote}>
                  {saved.description.trim() || agentModeLabel(saved.agent)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      }
      actions={[
        {
          label: "Cancel",
          tone: "secondary",
          onClick: onDismiss,
          // Leaving with nothing imported is the safe answer, so it is what Enter takes
          // on a dialog raised by accident.
          autoFocus: true,
        },
      ]}
    />
  );
}
