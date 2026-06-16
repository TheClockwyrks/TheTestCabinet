import { useState } from "react";
import { DESIGN_OPTIONS } from "./designs";
import { useDesignVariant } from "./DesignVariantContext";
import styles from "./DesignSwitcher.module.scss";

// A fixed, absolutely-positioned control that floats over the detail page and
// flips between the four design directions. It is a temporary exploration tool
// for choosing a direction, not part of the real UI — it sits in the corner,
// collapses to a single chip, and the active choice persists across navigation
// via `DesignVariantContext`.
export function DesignSwitcher() {
  const { design, setDesign } = useDesignVariant();
  const [open, setOpen] = useState(true);
  const active = DESIGN_OPTIONS.find((option) => option.id === design);

  return (
    <aside
      className={styles.switcher}
      aria-label="Detail page design switcher"
      data-open={open}
    >
      <button
        type="button"
        className={styles.handle}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.handleLabel}>Design</span>
        <span className={styles.handleValue}>{active?.label ?? design}</span>
        <span className={styles.handleChevron} aria-hidden="true">
          {open ? "▸" : "◂"}
        </span>
      </button>

      {open && (
        <ul className={styles.options}>
          {DESIGN_OPTIONS.map((option, index) => {
            const selected = option.id === design;
            return (
              <li key={option.id}>
                <button
                  type="button"
                  className={
                    selected
                      ? `${styles.option} ${styles.optionActive}`
                      : styles.option
                  }
                  aria-pressed={selected}
                  onClick={() => setDesign(option.id)}
                >
                  <span className={styles.optionIndex}>{index + 1}</span>
                  <span className={styles.optionText}>
                    <span className={styles.optionLabel}>{option.label}</span>
                    <span className={styles.optionTagline}>{option.tagline}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
