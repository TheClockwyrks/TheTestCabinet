import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
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
  /**
   * Render the whole track inert — how a read-only form shows a choice that was made
   * elsewhere. The selection still reads (and still slides), it simply cannot be moved.
   */
  disabled?: boolean;
}

// A compact two-or-more-way toggle: every option sits inside one shared border,
// and a single highlight slides behind the selected one. Built as an ARIA radio
// group so it is keyboard- and screen-reader-navigable. The slide is pure CSS —
// equal-width segments mean the highlight is `100% / count` wide and translated
// by the selected index.
//
// The segments are never compressed below their labels, since unequal segments
// would leave the highlight sitting on the wrong one. A track wider than the space
// it is given scrolls sideways instead, like the run page's tab strip: the edge
// with more segments past it fades, and the selected segment is kept in view.
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  disabled = false,
}: SegmentedControlProps<T>) {
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  const scroller = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ start: false, end: false });
  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setOverflow((prev) =>
      prev.start === start && prev.end === end ? prev : { start, end },
    );
  }, []);
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [measure]);
  // Bring the selected segment into view whenever the selection moves, whether the
  // reader chose it or the host did. Only the track scrolls; the page never does.
  useLayoutEffect(() => {
    const el = scroller.current;
    const segment = el?.querySelectorAll<HTMLElement>("[role=radio]")[index];
    if (!el || !segment) return;
    const left = segment.offsetLeft;
    const right = left + segment.offsetWidth;
    if (left < el.scrollLeft) el.scrollLeft = left;
    else if (right > el.scrollLeft + el.clientWidth)
      el.scrollLeft = right - el.clientWidth;
    measure();
  }, [index, measure]);

  return (
    <div
      ref={scroller}
      className={styles.scroller}
      data-overflow-start={overflow.start || undefined}
      data-overflow-end={overflow.end || undefined}
      onScroll={measure}
    >
      <div
        className={`${styles.control}${disabled ? ` ${styles.disabled}` : ""}`}
        role="radiogroup"
        aria-label={ariaLabel}
        aria-disabled={disabled || undefined}
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
            disabled={disabled}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
