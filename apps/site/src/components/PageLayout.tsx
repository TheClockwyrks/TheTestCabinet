import type { ReactNode } from "react";
import { Link, NavLink } from "react-router";
import { routes } from "../routes";
import { CabinetIcon } from "./CabinetIcon";
import { SunToggle } from "./SunToggle";
import styles from "./PageLayout.module.scss";

interface PageLayoutProps {
  children: ReactNode;
}

// The section nav. Defined once, in route order, so every page shares the same
// links and they all flow through `routes.ts` (never inline path literals).
const NAV_LINKS: ReadonlyArray<{ label: string; to: string }> = [
  { label: "Home", to: routes.home() },
  { label: "Test Cases", to: routes.testCases() },
  { label: "Models", to: routes.models() },
  { label: "About", to: routes.about() },
];

// Shared app chrome: a full-width topbar with the cabinet mark and wordmark on
// the left, the section nav in the middle, and the sun toggle on the right,
// over the routed page body. The bar spans the viewport while its contents stay
// aligned to the page's content column. All colors flow from the active design
// variant's palette.
export function PageLayout({ children }: PageLayoutProps) {
  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.bar}>
          <Link to={routes.home()} className={styles.brand}>
            <CabinetIcon className={styles.mark} />
            <span className={styles.wordmark}>The Test Cabinet</span>
          </Link>
          <nav className={styles.nav}>
            {NAV_LINKS.map((link) => (
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
            <SunToggle />
          </div>
        </div>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
