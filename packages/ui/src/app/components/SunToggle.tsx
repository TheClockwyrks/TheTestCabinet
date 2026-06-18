import { useBackdropSettings } from "./backdrop/BackdropSettingsContext";
import styles from "./SunToggle.module.scss";

// Topbar control that shows or hides the backdrop's banded sun. Off by default;
// the choice persists across visits (see `BackdropSettingsContext`).
export function SunToggle() {
  const { sunEnabled, toggleSun } = useBackdropSettings();

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
