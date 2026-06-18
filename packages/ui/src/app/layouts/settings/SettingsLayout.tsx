import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { routes } from "../../routes";
import styles from "./SettingsLayout.module.scss";

// The Settings section's tabs. Each is its own route, so which tab reads as
// active is driven by the page that rendered the layout. Console-only
// (web/desktop); the static site never mounts these routes.
export type SettingsTab = "appearance" | "connections";

interface SettingsLayoutProps {
  /** Which tab the rendering page represents. */
  tab: SettingsTab;
  /** The tab body. */
  children: ReactNode;
}

// Shared chrome for the Settings section: the tab navigation, mirrored from the
// About / test-case detail pages. Each tab is a distinct URL so a section is
// linkable, so the bar uses NavLink rather than in-page state. The two tab pages
// stay thin and never duplicate this.
export function SettingsLayout({ tab, children }: SettingsLayoutProps) {
  const tabs: { key: SettingsTab; label: string; to: string }[] = [
    { key: "appearance", label: "Appearance", to: routes.settingsAppearance() },
    {
      key: "connections",
      label: "Connections",
      to: routes.settingsConnections(),
    },
  ];

  return (
    <PageLayout>
      <PromptHeader command="--settings" blink comment={<>// tune the cabinet</>} />
      <nav className={styles.tabs} aria-label="Settings sections">
        {tabs.map((entry) => (
          <NavLink
            key={entry.key}
            to={entry.to}
            className={
              entry.key === tab
                ? `${styles.tab} ${styles.tabActive}`
                : styles.tab
            }
          >
            {entry.label}
          </NavLink>
        ))}
      </nav>
      {children}
    </PageLayout>
  );
}
