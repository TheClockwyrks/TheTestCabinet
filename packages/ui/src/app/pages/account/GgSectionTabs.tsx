import { Link } from "react-router";
import { routes } from "../../routes";
import styles from "./GgSectionTabs.module.scss";

/** Which of the gg tab's two libraries the rendering page lists. */
export type GgSectionTab = "configs" | "agents";

/**
 * The gg tab's second strip: its configurations and the agents they import.
 *
 * Two lists rather than one because they are edited at different rates. A
 * configuration is a whole run's shape, an agent is one profile several
 * configurations share, and an operator authoring the second should not have to open
 * the first to reach it.
 */
export function GgSectionTabs({ active }: { active: GgSectionTab }) {
  const tabs: { key: GgSectionTab; label: string; to: string }[] = [
    { key: "configs", label: "Configurations", to: routes.accountGgConfigs() },
    { key: "agents", label: "Agents", to: routes.accountGgAgents() },
  ];
  return (
    <nav className={styles.tabs} aria-label="gg libraries">
      {tabs.map((entry) => (
        <Link
          key={entry.key}
          to={entry.to}
          className={
            entry.key === active
              ? `${styles.tab} ${styles.tabActive}`
              : styles.tab
          }
          aria-current={entry.key === active ? "page" : undefined}
        >
          {entry.label}
        </Link>
      ))}
    </nav>
  );
}
