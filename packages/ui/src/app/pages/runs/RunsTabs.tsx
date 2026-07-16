import { NavLink } from "react-router";
import { useGalleryData } from "../../data/galleryContext";
import { routes } from "../../routes";
import styles from "./RunsTabs.module.scss";

// Which runs surface the rendering page represents, so its tab reads as active.
export type RunsTab = "runs" | "failures" | "unreviewed";

// The shared tab navigation across the runs section's index surfaces. Each tab is
// its own route (so a surface is linkable), mirroring the Settings section's tab
// bar. Failures and Unreviewed are console-only reviewer tooling — their routes
// aren't mounted on the static site — so the public gallery sees only the lone
// Runs tab, where a tab bar is redundant and is dropped entirely. (The coverage
// dashboard moved to the account section's Coverage tab.)
export function RunsTabs({ active }: { active: RunsTab }) {
  const { canExecute } = useGalleryData();
  const tabs: { key: RunsTab; label: string; to: string }[] = [
    { key: "runs", label: "Runs", to: routes.runs() },
    ...(canExecute
      ? [
          {
            key: "failures" as const,
            label: "Failures",
            to: routes.runFailures(),
          },
          {
            key: "unreviewed" as const,
            label: "Unreviewed",
            to: routes.runUnreviewed(),
          },
        ]
      : []),
  ];

  if (tabs.length <= 1) return null;

  return (
    <nav className={styles.tabs} aria-label="Runs sections">
      {tabs.map((entry) => (
        <NavLink
          key={entry.key}
          to={entry.to}
          className={
            entry.key === active
              ? `${styles.tab} ${styles.tabActive}`
              : styles.tab
          }
        >
          {entry.label}
        </NavLink>
      ))}
    </nav>
  );
}
