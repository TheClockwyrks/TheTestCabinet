import type { CSSProperties } from "react";
import styles from "./SegmentedControl.module.scss";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  /** The selectable options, rendered left to right in equal widths. */
  options: ReadonlyArray<SegmentedOption<T>>;
  /** The currently selected value. */
  value: T;
  /** Called with the newly selected value when a segment is clicked. */
  onChange: (value: T) => void;
  /** Accessible label for the group. */
  ariaLabel?: string;
}

// A compact two-or-more-way toggle: every option sits inside one shared border,
// and a single highlight slides behind the selected one. Built as an ARIA radio
// group so it is keyboard- and screen-reader-navigable. The slide is pure CSS —
// equal-width segments mean the highlight is `100% / count` wide and translated
// by the selected index.
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: SegmentedControlProps<T>) {
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  return (
    <div
      className={styles.control}
      role="radiogroup"
      aria-label={ariaLabel}
      style={
        {
          "--seg-count": options.length,
          "--seg-index": index,
        } as CSSProperties
      }
    >
      <span className={styles.thumb} aria-hidden="true" />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={styles.segment}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
