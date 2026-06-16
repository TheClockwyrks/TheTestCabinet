import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { routes } from "../../routes";
import styles from "./AboutLayout.module.scss";

// The About section's tabs. Each is its own route, so which tab reads as active
// is driven by the page that rendered the layout.
export type AboutTab = "about" | "testing" | "metrics";

interface AboutLayoutProps {
  /** Which tab the rendering page represents. */
  tab: AboutTab;
  /** The tab body. */
  children: ReactNode;
}

// Shared chrome for the About section: the tab navigation, mirrored from the
// test-case detail pages. Each tab is a distinct URL so a section is linkable,
// so the bar uses NavLink rather than in-page state. The three tab pages stay
// thin and never duplicate this.
export function AboutLayout({ tab, children }: AboutLayoutProps) {
  const tabs: { key: AboutTab; label: string; to: string }[] = [
    { key: "about", label: "About", to: routes.about() },
    { key: "testing", label: "Testing", to: routes.aboutTesting() },
    { key: "metrics", label: "Metrics", to: routes.aboutMetrics() },
  ];

  return (
    <PageLayout>
      <PromptHeader command="--about" comment={<>// shall we play a game?</>} />
      <nav className={styles.tabs} aria-label="About sections">
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
