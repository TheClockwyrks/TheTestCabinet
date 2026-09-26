import styles from "./ResetControl.module.scss";

/**
 * The affordance that puts one setting back to the value it starts at, sat beside that
 * setting's label.
 *
 * It renders **only** while the setting has moved off its default, and that is the whole
 * point of it: a form whose controls all show a real value cannot otherwise say which of
 * them are still as they came. The alternative — annotating labels with "(starts off)",
 * "(default: 3)" and the like — states the default in prose beside a control that is
 * already showing something else, which is both noise on every unmodified row and a lie
 * on every modified one.
 *
 * Pairing it with a control seeded to its default is what makes the two halves work: the
 * value is always readable in the field, and the marker is always readable beside the
 * label. Neither half is useful alone, so a field that is left blank to mean "use the
 * default" should be seeded instead of given one of these.
 */
export function ResetControl({
  /** What is being reset, for the control's accessible name — "Max retries". */
  label,
  onReset,
}: {
  label: string;
  onReset: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.reset}
      aria-label={`Reset ${label}`}
      title={`Reset ${label}`}
      onClick={onReset}
    >
      ↺
    </button>
  );
}
