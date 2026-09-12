import styles from "./LoadFailureState.module.scss";

/** How much of the viewport the surface that failed to load occupies. Mirrors
 * {@link LoadingState}'s sizes so a surface reports its failure at the same
 * scale it would have reported its wait. */
export type LoadFailureSize = "page" | "section";

interface LoadFailureStateProps {
  /** What could not be read, as a noun phrase: "the model catalog", "this run". */
  subject: string;
  /** The failure's own detail, when the read reported one. */
  detail?: string | null;
  size?: LoadFailureSize;
}

// The third state every read has, and the one the app kept collapsing into the
// other two: the read FAILED. A surface that is waiting shows `LoadingState`; a
// surface whose read settled with nothing names the thing as not found; a
// surface whose read never settled says so here, and never claims the entity
// does not exist. See the UI overview's "Loading, absence and failure".
//
// It is an `alert` rather than quiet copy because the page below it is missing
// content the reader asked for, and it offers the retry that actually works from
// here — reloading re-runs every read the page makes.
export function LoadFailureState({
  subject,
  detail,
  size = "page",
}: LoadFailureStateProps) {
  return (
    <div className={`${styles.wrap} ${styles[size]}`} role="alert">
      <p className={styles.headline}>Could not load {subject}.</p>
      {detail && <p className={styles.detail}>{detail}</p>}
      <p className={styles.hint}>Reload the page to try the read again.</p>
    </div>
  );
}
