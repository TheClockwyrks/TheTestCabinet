import { useEffect, useState } from "react";
import { NavLink } from "react-router";
import { useGalleryData } from "../../data/galleryContext";
import { useOptionalWorkers } from "../../../client/context";
import { useRunsRuntime } from "../../runtime/runsRuntime";
import { useRecordSectionIndex } from "../../components/backReturn";
import { useLiveRunUpdates } from "../../runtime/useLiveRunUpdates";
import { routes } from "../../routes";
import styles from "./RunsTabs.module.scss";

// Which runs surface the rendering page represents, so its tab reads as active.
export type RunsTab =
  | "runs"
  | "comparisons"
  | "failures"
  | "unreviewed"
  | "unpublished"
  | "unreadable";

// The tab strip across the runs section's index surfaces. Each tab is its own route
// (so a surface is linkable), mirroring the Settings section's tab bar. The default
// Tests tab (the run log) and Comparisons are both rendered on every host — a
// published comparison is public, read-only off the snapshot on the static site.
// Failures, Unreviewed, Unpublished, and Unreadable are console-only reviewer
// tooling — their routes aren't mounted on the static site, and the public gallery
// holds nothing unreviewed, unpublished, or unreadable by definition — so it sees
// just Tests and Comparisons.
// (The coverage dashboard moved to the account section's Coverage tab.)
//
// Unreadable is further gated on the cabinet actually holding such a run, so the
// strip carries a sixth tab only while there is something behind it. Its count is
// read here rather than on the page, because the strip renders on every runs
// surface and the tab has to appear (and retire) wherever the reviewer is.
//
// The bar is the strip and nothing else. It used to carry the global stop controls on
// its trailing edge, which worked while there were four tabs and stopped working at
// five: a strip of five plus a cluster of three buttons wraps onto a second row at any
// ordinary window width, and the row it wrapped onto pushed the whole page down. Those
// controls now ride the page header's comment line — see `StopRunsControls` — which is
// a half-empty row on every one of these pages and costs no height at all.
//
// The bar is a `<nav>`: the runs index's own stylesheet owns the gap between it and the
// filter bar beneath via a `> nav` child selector, so the element the page sees must
// stay the nav.
export function RunsTabs({ active }: { active: RunsTab }) {
  const { canExecute } = useGalleryData();
  // The whole Runs section depends on a live in-flight list — the Runs tab lists those
  // runs, and the header's stop controls size themselves from the same list — so the
  // run-lifecycle topic is declared here, once, rather than by each tab.
  useLiveRunUpdates();
  // Remember this surface so a run's detail back-control returns to the tab the
  // user was on (Tests / Comparisons / Failures / Unreviewed / Unpublished), not
  // always the default Tests tab. Recorded unconditionally, even where the bar itself is
  // dropped below.
  useRecordSectionIndex("runs");
  const unreadable = useUnreadableCount();
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
          {
            key: "unpublished" as const,
            label: "Unpublished",
            to: routes.runUnpublished(),
          },
        ]
      : []),
    ...(canExecute && unreadable > 0
      ? [
          {
            key: "unreadable" as const,
            label: `Unreadable (${unreadable})`,
            to: routes.runUnreadable(),
          },
        ]
      : []),
  ];

  // A lone tab is no navigation at all, so the bar drops entirely. Tests and
  // Comparisons render on every host, so today this never fires — it guards a host
  // that mounts neither of the reviewer tabs *and* loses one of the public two.
  if (tabs.length <= 1) return null;

  return (
    <nav className={styles.bar} aria-label="Runs sections">
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

// How many stored runs the backend cannot decode, or 0 where the host cannot ask.
// Re-read on the runs runtime's refresh token, so deleting the last one retires the
// tab without a reload.
function useUnreadableCount(): number {
  const client = useOptionalWorkers()?.active?.client ?? null;
  const { refreshToken } = useRunsRuntime();
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!client?.listUnreadableRuns) {
      setCount(0);
      return;
    }
    let active = true;
    client
      // Only the total is read here, so ask for the smallest page that carries one.
      .listUnreadableRuns({ limit: 1 })
      .then((page) => {
        if (active) setCount(page.total);
      })
      .catch(() => {
        if (active) setCount(0);
      });
    return () => {
      active = false;
    };
  }, [client, refreshToken]);
  return count;
}
