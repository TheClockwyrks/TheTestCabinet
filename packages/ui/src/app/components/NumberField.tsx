import { useId } from "react";
import {
  readNumberField,
  useNumberDraft,
  type NumberFieldBounds,
} from "./numberFieldRules";

// The rules and the control are one import for a call site: the form reads its
// fields with the same helpers it renders them with.
export {
  readNumberField,
  useNumberDraft,
  useNumberFieldState,
  type NumberDraft,
  type NumberFieldBounds,
  type NumberFieldProblem,
  type NumberFieldState,
  type NumberFieldVerdict,
} from "./numberFieldRules";
import styles from "./NumberField.module.scss";

/**
 * The themed numeric input.
 *
 * It is controlled by the **text** the operator typed, never by a number, so the
 * field can be cleared and retyped — see `numberFieldRules.ts` for why that is the
 * whole point, and `components/ui/overview` → "Numeric fields" for the rule.
 * Clearing it is not corrected: the field reports itself invalid and the form is
 * expected to refuse to submit while it is.
 *
 * It brings no look of its own. Pass the class the surrounding form styles its
 * inputs with (`exec.input` on the run-execution surfaces) and this adds the
 * invalid border and the sentence beneath.
 */
export interface NumberFieldProps extends NumberFieldBounds {
  /** The text the field shows: state the caller holds, verbatim. */
  value: string;
  /** Every keystroke, unfiltered — store it as typed. */
  onChange: (raw: string) => void;
  /** The spinner's step. Defaults to 1 for an integer field. */
  step?: number;
  /** Claims the id a {@link SettingRow} or {@link CapField} hands its label. */
  id?: string;
  /** The form's own input class. */
  className?: string;
  /** Wraps the input and its problem sentence. */
  wrapperClassName?: string;
  /**
   * Styles the problem sentence. Out on the animated backdrop it needs the
   * readability halo, which is a decision only the page can make.
   */
  problemClassName?: string;
  placeholder?: string;
  title?: string;
  disabled?: boolean;
  ariaLabel?: string;
  /**
   * Whether to draw the problem sentence beneath the field. Turn it off where the
   * field sits in a column too narrow to read a sentence in — the form still has
   * to say why it will not submit, next to the control that is refusing.
   */
  showProblem?: boolean;
  onBlur?: () => void;
}

export function NumberField({
  value,
  onChange,
  min,
  max,
  integer,
  optional,
  label,
  step,
  id,
  className,
  wrapperClassName,
  problemClassName,
  placeholder,
  title,
  disabled,
  ariaLabel,
  showProblem = true,
  onBlur,
}: NumberFieldProps) {
  const bounds: NumberFieldBounds = { min, max, integer, optional, label };
  const verdict = readNumberField(value, bounds);
  const problemId = useId();
  // A disabled field is not being answered, so it is not reported as wrong either.
  const showing = showProblem && !disabled && verdict.message !== null;

  return (
    <span
      className={[styles.field, wrapperClassName].filter(Boolean).join(" ")}
    >
      <input
        id={id}
        className={[
          className,
          styles.input,
          verdict.valid || disabled ? null : styles.invalid,
        ]
          .filter(Boolean)
          .join(" ")}
        type="number"
        // The numeric soft keyboard, rather than the full one a `type="number"`
        // gets on some mobile browsers. `decimal` keeps the separator key for a
        // field that accepts a fraction.
        inputMode={integer ? "numeric" : "decimal"}
        min={min}
        max={max}
        step={step ?? (integer ? 1 : undefined)}
        value={value}
        placeholder={placeholder}
        title={title}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={verdict.valid || disabled ? undefined : true}
        aria-describedby={showing ? problemId : undefined}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
      {showing && (
        <span
          id={problemId}
          className={[styles.problem, problemClassName]
            .filter(Boolean)
            .join(" ")}
        >
          {verdict.message}
        </span>
      )}
    </span>
  );
}

/**
 * A {@link NumberField} over a value that is already held as a number somewhere
 * else — a typed record, or a model the edit applies to live.
 *
 * The typing lives here; `value` stays the truth. `onCommit` fires only when the
 * typing names a value within bounds, so an edit passing through empty leaves the
 * value alone rather than snapping it to a floor. Blurring an unusable field
 * restores the committed value.
 *
 * Where the form holds its own draft until a submit, control {@link NumberField}
 * with a string of state instead — that is the shape the docs ask for, and it
 * lets the submit gate refuse on the same reading the field shows.
 */
export function NumberValueField({
  value,
  onCommit,
  onClear,
  min,
  max,
  integer,
  optional,
  label,
  ...rest
}: Omit<NumberFieldProps, "value" | "onChange" | "onBlur"> & {
  value: number | undefined;
  onCommit: (value: number) => void;
  /** Required on an `optional` field: clearing it is an answer, and has to land. */
  onClear?: () => void;
}) {
  const draft = useNumberDraft(
    value,
    { min, max, integer, optional, label },
    onCommit,
    onClear,
  );
  return (
    <NumberField
      {...rest}
      {...draft.bounds}
      value={draft.raw}
      onChange={draft.setRaw}
      onBlur={draft.release}
    />
  );
}
