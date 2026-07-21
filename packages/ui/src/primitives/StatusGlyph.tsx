import styles from "./StatusGlyph.module.scss";

// `pass` and `fail` are outcomes a check actually produced; `none` is the absence
// of one — a step never reached, or a script the debug-API gate stopped from
// running. `none` is deliberately not a failure and is not colored like one.
export type StatusGlyphStatus = "pass" | "fail" | "none";

const GLYPH: Record<StatusGlyphStatus, string> = {
  pass: "✔",
  fail: "✘",
  none: "—",
};

// A check outcome as a single glyph, for the result column of the run detail
// pages' `.checks` tables. These columns previously held words ("Pass" / "Fail" /
// "Did not run", "Yes" / "No" / "Not reached"), which set the column width from
// the longest phrase and pushed the wider tables toward their card edge.
//
// The glyph alone would strand that wording, so `label` carries it: it is the
// accessible name (the span is a `role="img"`, so assistive tech announces the
// label instead of trying to read the mark) and the hover title, which is how a
// sighted reader recovers the distinction between "did not run" and "not
// reached" — a difference the shared em dash does not itself draw.
export function StatusGlyph({
  status,
  label,
}: {
  status: StatusGlyphStatus;
  label: string;
}) {
  return (
    <span
      className={styles.glyph}
      data-status={status}
      role="img"
      aria-label={label}
      title={label}
    >
      {GLYPH[status]}
    </span>
  );
}
