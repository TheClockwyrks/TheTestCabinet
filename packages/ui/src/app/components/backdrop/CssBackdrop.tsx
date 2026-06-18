import styles from "./CssBackdrop.module.scss";

// The flat, dependency-free synthwave grid: a horizon glow plus a
// CSS-perspective grid. Used both as the instant Suspense fallback while the
// WebGL scene's chunk loads and as the permanent fallback when WebGL is
// unavailable or the user prefers reduced motion. Purely decorative.
export function CssBackdrop() {
  return (
    <>
      <div className={styles.glow} />
      <div className={styles.grid} />
    </>
  );
}
