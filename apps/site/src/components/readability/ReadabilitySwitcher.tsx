import { useState } from "react";
import { useReadability } from "./ReadabilityContext";
import { READABILITY_OPTIONS } from "./variants";
import styles from "./ReadabilitySwitcher.module.scss";

// A floating, viewport-pinned control for trying each readability treatment
// against the live pages. It starts collapsed as a single chip; expanding it
// lists every variant with a one-line description, and the choice persists via
// the readability context. Mounted once, globally, in `main.tsx`.
//
// This is a comparison aid while we settle on a default — once a treatment is
// chosen it can be removed and the winner baked into `DEFAULT_READABILITY`.
export function ReadabilitySwitcher() {
  const { variant, setVariant } = useReadability();
  const [open, setOpen] = useState(false);

  return (
    <div className={styles.switcher}>
      {open ? (
        <div className={styles.panel} role="group" aria-label="Readability">
          <div className={styles.head}>
            <span className={styles.title}>Readability</span>
            <button
              type="button"
              className={styles.close}
              onClick={() => setOpen(false)}
              aria-label="Collapse readability switcher"
            >
              ×
            </button>
          </div>
          <div className={styles.options}>
            {READABILITY_OPTIONS.map((option) => {
              const active = option.id === variant;
              const cls = active
                ? `${styles.option} ${styles.optionActive}`
                : styles.option;
              return (
                <button
                  key={option.id}
                  type="button"
                  className={cls}
                  aria-pressed={active}
                  onClick={() => setVariant(option.id)}
                >
                  <span className={styles.optionLabel}>
                    <span className={styles.optionMark} aria-hidden="true">
                      {active ? "▸" : " "}
                    </span>
                    {option.label}
                  </span>
                  <span className={styles.optionHint}>{option.hint}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={styles.handle}
          onClick={() => setOpen(true)}
          title="Choose a readability treatment"
        >
          <span className={styles.glyph} aria-hidden="true">
            ◐
          </span>
          Readability
        </button>
      )}
    </div>
  );
}
