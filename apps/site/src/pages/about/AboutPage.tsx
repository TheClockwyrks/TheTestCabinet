import { useState } from "react";
import { PageLayout } from "../../components/PageLayout";
import { Markdown } from "../../components/Markdown";
import { Panel } from "../../components/Panel";
// The About page is three Markdown files on disk — edit `about.md`,
// `testing.md`, or `metrics.md` and the page follows. Each maps to a tab, so the
// page reuses the same tab-bar treatment as the test-case detail pages. We pull
// each in raw (same approach as data/writeups.ts) and hand the active one to the
// shared <Markdown> renderer for GFM + neon-themed prose. The content is pure
// prose over the backdrop, so it goes in a <Panel> to stay legible against the
// grid.
import about from "./about.md?raw";
import testing from "./testing.md?raw";
import metrics from "./metrics.md?raw";
import styles from "./AboutPage.module.scss";

// The tabs are in-page state rather than routes — the About content is a single
// URL with three sections, unlike the test-case tabs where each tab is its own
// route.
const tabs = [
  { key: "about", label: "About", content: about },
  { key: "testing", label: "Testing", content: testing },
  { key: "metrics", label: "Metrics", content: metrics },
] as const;

type TabKey = (typeof tabs)[number]["key"];

export function AboutPage() {
  const [active, setActive] = useState<TabKey>("about");
  const current = tabs.find((tab) => tab.key === active) ?? tabs[0];

  return (
    <PageLayout>
      <nav className={styles.tabs} aria-label="About sections">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={
              tab.key === active
                ? `${styles.tab} ${styles.tabActive}`
                : styles.tab
            }
            onClick={() => setActive(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <Panel>
        <Markdown>{current.content}</Markdown>
      </Panel>
    </PageLayout>
  );
}
