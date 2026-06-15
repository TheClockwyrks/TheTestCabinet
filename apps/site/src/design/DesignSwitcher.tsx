import { useEffect, useState } from "react";
import { useDesignVariant } from "./useDesignVariant";
import { DESIGN_VARIANTS } from "./variants";
import styles from "./DesignSwitcher.module.scss";

// Absolutely-positioned design-direction switcher. Sits above the page so the
// active variant can be flipped while evaluating directions. This is a
// temporary exploration tool, not part of the shipped site chrome — it carries
// its own neutral styling so it stays legible over every variant, and it binds
// number keys 1..4 as shortcuts.
export function DesignSwitcher() {
  const { variant, setVariant } = useDesignVariant();
  const [open, setOpen] = useState(true);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Ignore shortcuts while typing into a field.
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          /^(input|textarea|select)$/i.test(target.tagName))
      ) {
        return;
      }
      const index = Number(event.key) - 1;
      const meta = Number.isInteger(index) ? DESIGN_VARIANTS[index] : undefined;
      if (meta) {
        setVariant(meta.id);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setVariant]);

  if (!open) {
    return (
      <button
        type="button"
        className={styles.reopen}
        onClick={() => setOpen(true)}
        aria-label="Open design switcher"
      >
        Design
      </button>
    );
  }

  return (
    <aside className={styles.panel} aria-label="Design variant switcher">
      <div className={styles.header}>
        <span className={styles.title}>Design preview</span>
        <button
          type="button"
          className={styles.collapse}
          onClick={() => setOpen(false)}
          aria-label="Collapse design switcher"
        >
          ×
        </button>
      </div>
      <ul className={styles.list}>
        {DESIGN_VARIANTS.map((meta, index) => {
          const active = meta.id === variant;
          return (
            <li key={meta.id}>
              <button
                type="button"
                className={`${styles.option}${active ? ` ${styles.active}` : ""}`}
                onClick={() => setVariant(meta.id)}
                aria-pressed={active}
              >
                <span className={styles.key}>{index + 1}</span>
                <span className={styles.optionText}>
                  <span className={styles.name}>{meta.name}</span>
                  <span className={styles.blurb}>{meta.blurb}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className={styles.hint}>Press 1&ndash;{DESIGN_VARIANTS.length} to switch</p>
    </aside>
  );
}
