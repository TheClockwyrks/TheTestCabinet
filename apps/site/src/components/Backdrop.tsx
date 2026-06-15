import styles from "./Backdrop.module.scss";

// Full-viewport atmosphere rendered behind all page content: the synthwave
// perspective grid with a horizon glow, overlaid with faint CRT scanlines.
// Purely decorative and non-interactive.
export function Backdrop() {
  return (
    <div className={styles.backdrop} aria-hidden="true">
      <div className={styles.glow} />
      <div className={styles.grid} />
      <div className={styles.scanlines} />
    </div>
  );
}
