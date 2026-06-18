import type { ReactNode } from "react";
import { Link, NavLink } from "react-router";
import { routes } from "../routes";
import { useGalleryData } from "../data/galleryContext";
import { CabinetIcon } from "./CabinetIcon";
import styles from "./PageLayout.module.scss";
import exec from "../pages/runs/RunExec.module.scss";

interface PageLayoutProps {
  children: ReactNode;
  /**
   * Lay the page body out as a full-height column so a child marked to fill (the
   * live run monitor's event feed) expands into the space below the header.
   */
  fill?: boolean;
}

// A small gear glyph for the connections/settings drawer trigger.
function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

// The section nav. Defined once, in route order, so every page shares the same
// links and they all flow through `routes.ts` (never inline path literals). The
// About link is appended only on the static site (see below): the consoles
// surface configuration through the Settings gear instead.
const NAV_LINKS: ReadonlyArray<{ label: string; to: string }> = [
  { label: "Home", to: routes.home() },
  { label: "Test Cases", to: routes.testCases() },
  { label: "Runs", to: routes.runs() },
  { label: "Models", to: routes.models() },
];

// Shared app chrome: a full-width topbar with the cabinet mark and wordmark on
// the left, the section nav in the middle, and the sun toggle on the right,
// over the routed page body. The bar spans the viewport while its contents stay
// aligned to the page's content column. All colors flow from the active design
// variant's palette.
export function PageLayout({ children, fill = false }: PageLayoutProps) {
  const { canExecute } = useGalleryData();
  // The consoles reach run configuration through the Settings gear; the static
  // site keeps the About link in the nav. Both surface the Settings gear — on
  // the site it opens the Appearance-only settings (the sun and feed-style
  // choices that used to live in the topbar toggle).
  const navLinks = canExecute
    ? NAV_LINKS
    : [...NAV_LINKS, { label: "About", to: routes.about() }];
  return (
    <div className={fill ? `${styles.shell} ${styles.shellFill}` : styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.bar}>
          <Link to={routes.home()} className={styles.brand}>
            <CabinetIcon className={styles.mark} />
            <span className={styles.wordmark}>The Test Cabinet</span>
          </Link>
          <nav className={styles.nav}>
            {navLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === routes.home()}
                className={({ isActive }) =>
                  isActive ? `${styles.navLink} ${styles.navActive}` : styles.navLink
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
          <div className={styles.controls}>
            <NavLink
              to={routes.settingsAppearance()}
              className={exec.gear}
              aria-label="Settings"
              title="Settings"
            >
              <GearIcon />
            </NavLink>
          </div>
        </div>
      </header>
      <main className={fill ? `${styles.main} ${styles.mainFill}` : styles.main}>
        {children}
      </main>
    </div>
  );
}
