// The designer's numeric controls, in the three disciplines this tool needs.
//
// A `type="number"` input driven by a *number* cannot hold an empty string, so
// clearing it used to hand the change handler `""`, which `Number()` turned into
// `0`, which a floor then corrected to the minimum — under the caret, mid-edit.
// On the grid-size fields that was destructive: clearing W to retype it resized
// the design to the 4×4 floor and dropped everything off the board.
//
// So the typing lives here and the model keeps the last value that was actually
// usable. Nothing outside the declared range is ever committed, and a field left
// saying nothing usable restores the committed value on blur.
//
// That is enough for a field that only TUNES something. It is not enough for one
// that changes what the design *is*. Three disciplines, in order of how much a
// wrong commit costs:
//
//   • `keystroke` — commits the instant the typing names a value in range. For a
//     value you want to hear the answer to as you type (a source's period), where
//     a wrong intermediate value costs a replay and nothing else.
//   • `blur` — commits when the field is left or Enter is pressed, Escape abandons.
//     For a value that must not be set from a digit typed on the way past, but
//     where applying it is not itself a loss (the run length, the snapshot list:
//     wrong, they are simply retyped).
//   • staged (`StagedNumberInput`) — commits NOTHING. The parent owns the text and
//     an explicit control applies it. For a value whose commit can cost the user
//     work: the board size, where a resize takes components off the board and there
//     is no undo. Leaving a field is a decision to stop typing, not a decision to
//     restructure the design, so blur must not be what applies it.
//
// The rules come from the console's `numberFieldRules` (aliased as `@numeric`),
// so a field here is read exactly as one in the console is. See
// `components/ui/overview` → "Numeric fields".

import { useState, type CSSProperties, type KeyboardEvent } from "react";
import {
  readNumberField,
  useNumberDraft,
  type NumberFieldBounds,
} from "@numeric";
import { fieldText, stepNumberField, type FieldEvent } from "./numberField";

/**
 * When the typing reaches the model.
 *
 * - `keystroke` — the instant it names a value in range, for a field that tunes
 *   something and reads better live.
 * - `blur` — when the field is left or Enter is pressed, for a field whose commit
 *   must not fire from a digit typed on the way past.
 *
 * A field that must not commit on its own at all is not a mode of this control —
 * it is {@link StagedNumberInput}, which has no `onCommit` to give it.
 */
export type CommitWhen = "keystroke" | "blur";

/** The parts of the control that are the same whichever discipline it follows. */
interface FieldChrome {
  title?: string;
  step?: number;
  style?: CSSProperties;
  className?: string;
  ariaLabel?: string;
}

type NumberInputProps = NumberFieldBounds &
  FieldChrome & {
    /** The committed value the field mirrors while it is not being edited. */
    value: number;
    /** Called only when the typing names a value inside the declared range. */
    onCommit: (value: number) => void;
    commit?: CommitWhen;
  };

export function NumberInput({
  commit = "keystroke",
  ...props
}: NumberInputProps) {
  // Two different disciplines, so two components rather than a conditional hook.
  return commit === "blur" ? (
    <HeldNumberInput {...props} />
  ) : (
    <LiveNumberInput {...props} />
  );
}

type ModeProps = Omit<NumberInputProps, "commit">;

/** A field whose value follows the typing as soon as the typing names one. */
function LiveNumberInput(props: ModeProps) {
  const bounds = boundsOf(props);
  const draft = useNumberDraft(props.value, bounds, props.onCommit);
  return (
    <Input
      chrome={props}
      bounds={bounds}
      text={draft.raw}
      message={draft.message}
      onText={draft.setRaw}
      onBlur={draft.release}
    />
  );
}

/** A field whose value changes only when the edit is finished with. */
function HeldNumberInput(props: ModeProps) {
  const bounds = boundsOf(props);
  const { value, onCommit } = props;
  const [draft, setDraft] = useState<string | null>(null);
  const text = fieldText(draft, value);
  // Read for the caret's benefit only: an invalid held field is a warning that
  // leaving it now restores the value, not a refusal to go on typing.
  const verdict = readNumberField(text, bounds);

  const apply = (event: FieldEvent) => {
    const step = stepNumberField(draft, value, bounds, event);
    setDraft(step.draft);
    if (step.commit !== null) onCommit(step.commit);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      apply({ type: "commit" });
    } else if (e.key === "Escape") {
      e.preventDefault();
      apply({ type: "revert" });
    }
  };

  return (
    <Input
      chrome={props}
      bounds={bounds}
      text={text}
      message={verdict.message}
      onText={(raw) => apply({ type: "type", raw })}
      onBlur={() => apply({ type: "commit" })}
      onKeyDown={onKeyDown}
    />
  );
}

type StagedProps = NumberFieldBounds &
  FieldChrome & {
    /** The text, owned by the parent along with the rest of the staged form. */
    text: string;
    onText: (raw: string) => void;
    /**
     * Enter. This is the field's SUBMIT — the form's explicit apply, reached from
     * the keyboard — not an auto-apply: the parent routes it through exactly the
     * same gate (and the same confirmation) the Apply button goes through.
     */
    onSubmit?: () => void;
    /** Escape: put the staged form back to what the model actually holds. */
    onRevert?: () => void;
  };

/**
 * A field that commits nothing, ever.
 *
 * The text belongs to the parent, which holds it alongside whatever else is being
 * staged and applies the lot with one explicit control. Blur does nothing at all —
 * that is the whole point of this discipline.
 */
export function StagedNumberInput({
  text,
  onText,
  onSubmit,
  onRevert,
  ...props
}: StagedProps) {
  const bounds = boundsOf(props);
  const verdict = readNumberField(text, bounds);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onSubmit?.();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onRevert?.();
    }
  };

  return (
    <Input
      chrome={props}
      bounds={bounds}
      text={text}
      message={verdict.message}
      onText={onText}
      onKeyDown={onKeyDown}
    />
  );
}

function boundsOf(props: NumberFieldBounds): NumberFieldBounds {
  const { min, max, integer = true, label } = props;
  return { min, max, integer, label };
}

/** The shared markup: every discipline renders the same control. */
function Input({
  chrome,
  bounds,
  text,
  message,
  onText,
  onBlur,
  onKeyDown,
}: {
  chrome: FieldChrome;
  bounds: NumberFieldBounds;
  text: string;
  message: string | null;
  onText: (raw: string) => void;
  onBlur?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
}) {
  return (
    <input
      type="number"
      inputMode={bounds.integer ? "numeric" : "decimal"}
      min={bounds.min}
      max={bounds.max}
      step={chrome.step ?? (bounds.integer ? 1 : undefined)}
      style={chrome.style}
      className={chrome.className}
      aria-label={chrome.ariaLabel}
      // Both the sentence and the attribute, because the toolbar and the panels
      // have no room to print one: the styling hangs off `aria-invalid`, and the
      // sentence is what a hover says.
      aria-invalid={message === null ? undefined : true}
      title={message ?? chrome.title}
      value={text}
      onChange={(e) => onText(e.target.value)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    />
  );
}
