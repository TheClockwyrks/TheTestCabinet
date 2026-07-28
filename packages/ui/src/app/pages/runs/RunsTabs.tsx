import { NavLink } from "react-router";
import { useGalleryData } from "../../data/galleryContext";
import { useRecordSectionIndex } from "../../components/backReturn";
import { routes } from "../../routes";
import styles from "./RunsTabs.module.scss";

// Which runs surface the rendering page represents, so its tab reads as active.
export type RunsTab = "runs" | "comparisons" | "failures" | "unreviewed";

// The shared tab navigation across the runs section's index surfaces. Each tab is
// its own route (so a surface is linkable), mirroring the Settings section's tab
// bar. The default **Tests** tab (the run log) and **Comparisons** are both
// rendered on every host — a published comparison is public, read-only off the
// snapshot on the static site. Failures and Unreviewed are console-only reviewer
// tooling — their routes aren't mounted on the static site — so the public gallery
// sees just Tests and Comparisons. (The coverage dashboard moved to the account
// section's Coverage tab.)
export function RunsTabs({ active }: { active: RunsTab }) {
  const { canExecute } = useGalleryData();
  // Remember this surface so a run's detail back-control returns to the tab the
  // user was on (Tests / Comparisons / Failures / Unreviewed), not always the
  // default Tests tab. Recorded unconditionally.
  useRecordSectionIndex("runs");
  const tabs: { key: RunsTab; label: string; to: string }[] = [
    { key: "runs", label: "Tests", to: routes.runs() },
    {
      key: "comparisons",
      label: "Comparisons",
      to: routes.runsComparisons(),
    },
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
