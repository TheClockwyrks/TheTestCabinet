import { useDesignVariant } from "./useDesignVariant";
import styles from "./DesignBackground.module.scss";

// Full-viewport backdrop rendered behind all page content. It reads the active
// variant and paints the matching atmosphere (cabinet-room vignette, CRT
// scanlines, neon perspective grid, or a quiet minimal wash). Purely decorative
// and non-interactive.
export function DesignBackground() {
  const { variant } = useDesignVariant();
  // The neon grid and CRT scanlines are mix-and-match: "neonlog" layers the
  // scanlines over the neon grid to test that combination.
  const showGrid = variant === "neon" || variant === "neonlog";
  const showScanlines = variant === "crt" || variant === "neonlog";
  return (
    <div className={styles.backdrop} data-variant={variant} aria-hidden="true">
      {showGrid && (
        <>
          <div className={styles.neonGlow} />
          <div className={styles.neonGrid} />
        </>
      )}
      {showScanlines && <div className={styles.scanlines} />}
    </div>
  );
}
