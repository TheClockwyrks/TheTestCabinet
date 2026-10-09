import { useLayoutEffect, useRef } from "react";
import { Link } from "react-router";
import { routes } from "../../routes";
import styles from "./AccountTabs.module.scss";

// Which account surface the rendering page represents, so its tab reads as active.
export type AccountTab =
  | "profile"
  | "reviews"
  | "coverage"
  | "ladders"
  | "groups"
  | "ggAgents"
  | "ggConfigs";

// How much of an end tab must show for its edge to count as resting. Just short of
// all of it: a fractional layout width leaves a wholly scrolled strip a sliver shy.
const EDGE_VISIBLE = 0.98;

// The shared tab navigation across the account section. Each tab is its own route
// (so a surface is linkable), mirroring the runs section's tab bar. The whole
// section is console-only reviewer tooling gated on a signed-in account, so the
// caller only ever renders this for a signed-in reviewer — there is no public
// variant to drop tabs for.
//
// `aria-current` follows the caller's `active` rather than the URL, so the
// announced tab is always the one drawn as selected. A route-matched flag would
// disagree on every nested page: `/account` is a prefix of every other tab's path,
// and an editor like `/account/gg/:configId/edit` is not the list route its tab
// points at.
export function AccountTabs({ active }: { active: AccountTab }) {
  const tabs: { key: AccountTab; label: string; to: string }[] = [
    { key: "profile", label: "Profile", to: routes.account() },
    { key: "reviews", label: "Reviews", to: routes.accountReviews() },
    { key: "coverage", label: "Coverage", to: routes.accountCoverage() },
    // Ladders sit beside Coverage because they are the same tool asked a different
    // question — one fills a matrix, the other walks an ordered climb — and both are
    // fed from the same groups on the tab after them.
    { key: "ladders", label: "Ladders", to: routes.accountLadders() },
    { key: "groups", label: "Groups", to: routes.accountGroups() },
    // gg's two libraries are two tabs rather than one tab holding two lists: they
    // are edited at different rates — a configuration is a whole run's shape, an
    // agent is one profile several configurations share — and an operator
    // authoring the second should reach it the same way they reach every other
    // surface in this section. Agents lead because they are the part authored
    // first and reused most: a configuration is assembled from them.
    { key: "ggAgents", label: "gg Agents", to: routes.accountGgAgents() },
    { key: "ggConfigs", label: "gg Configs", to: routes.accountGgConfigs() },
  ];

  // Below the medium breakpoint the strip is a single swipeable row (see the
  // stylesheet), and seven tabs do not fit a phone: the later ones start off the
  // trailing edge. Two things keep that usable. The active tab is brought to the
  // middle of the strip on arrival, so the tab the page belongs to is never one
  // of the hidden ones and its neighbours on both sides show. And the strip
  // records which of its edges have tabs scrolled past them, which the stylesheet
  // fades, so a clipped edge reads as "more this way" and a resting edge stays
  // crisp. Where the row wraps or fits, nothing overflows: the scroll offset
  // stays zero and neither edge is marked.
  const navRef = useRef<HTMLElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const tab = activeRef.current;
    if (tab) {
      // Set the strip's own offset rather than calling `scrollIntoView`, which
      // would also scroll the page to the strip.
      const strip = nav.getBoundingClientRect();
      const rect = tab.getBoundingClientRect();
      nav.scrollLeft += rect.left - strip.left - (strip.width - rect.width) / 2;
    }
    // An edge has tabs past it exactly while the strip's first (or last) tab is
    // not wholly inside it, which an observer rooted on the strip reports on
    // scroll and on resize alike without a listener reading layout on either. A
    // host without the observer (a test DOM) marks no edge, which is the state
    // of a strip that fits.
    if (typeof IntersectionObserver === "undefined") return;
    const first = nav.firstElementChild;
    const last = nav.lastElementChild;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const clipped = entry.intersectionRatio < EDGE_VISIBLE;
          if (entry.target === first) {
            nav.toggleAttribute("data-more-start", clipped);
          }
          if (entry.target === last) {
            nav.toggleAttribute("data-more-end", clipped);
          }
        }
      },
      { root: nav, threshold: EDGE_VISIBLE },
    );
    if (first) observer.observe(first);
    if (last && last !== first) observer.observe(last);
    return () => {
      observer.disconnect();
    };
  }, [active]);

  return (
    <nav ref={navRef} className={styles.tabs} aria-label="Account sections">
      {tabs.map((entry) => (
        <Link
          key={entry.key}
          to={entry.to}
          ref={entry.key === active ? activeRef : undefined}
          className={
            entry.key === active
              ? [styles.tab, styles.tabActive].join(" ")
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
