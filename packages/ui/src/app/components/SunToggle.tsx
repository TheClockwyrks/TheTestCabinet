import { useAppSettings } from "../store/appSettings";
import styles from "./SunToggle.module.scss";

// Topbar control that shows or hides the backdrop's banded sun. On by default;
// the choice persists across visits (see `appSettings`). Used on the static site,
// where the topbar carries it directly; the consoles surface the same preference
// through the Appearance settings instead.
export function SunToggle() {
  const sunEnabled = useAppSettings((s) => s.sunEnabled);
  const toggleSun = useAppSettings((s) => s.toggleSun);

  return (
    <button
      type="button"
      className={styles.toggle}
      onClick={toggleSun}
      aria-pressed={sunEnabled}
      title={sunEnabled ? "Hide the synthwave sun" : "Show the synthwave sun"}
    >
      <span className={styles.glyph} aria-hidden="true">
        ☀
      </span>
      <span className={styles.label}>Sun {sunEnabled ? "on" : "off"}</span>
    </button>
  );
}
