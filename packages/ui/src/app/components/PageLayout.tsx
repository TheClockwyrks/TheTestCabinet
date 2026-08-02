import { useEffect, useId, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { Avatar } from "@test-cabinet/ui";
import { routes } from "../routes";
import { useGalleryData } from "../data/galleryContext";
import { useAuth } from "../../client/auth";
import { selectUnreadCount, useNotifications } from "../runtime/notifications";
import { BellIcon } from "./BellIcon";
import { CabinetIcon } from "./CabinetIcon";
import styles from "./PageLayout.module.scss";
import exec from "../pages/runs/RunExec.module.scss";

/**
 * An alternate identity + section nav for the topbar — how a page swaps the app's
 * chrome for a mode of its own without leaving the shell (today: the gg analysis
 * section). The bar, controls, and body layout are unchanged; only the brand
 * control and the nav links differ.
 */
export interface TopbarChrome {
  /** Where the brand control goes — for a mode, back out of it. */
  home: string;
  /** The wordmark beside the mark. */
  label: string;
  /**
   * Render the brand's mark as a back arrow rather than the cabinet icon, so the
   * control reads as "leave this mode" rather than "go home".
   */
  back?: boolean;
  /** The section nav's links, in order. */
  links: ReadonlyArray<{ label: string; to: string; end?: boolean }>;
}

interface PageLayoutProps {
  children: ReactNode;
  /**
   * Lay the page body out as a full-height column so a child marked to fill (the
   * live run monitor's event feed) expands into the space below the header.
   */
  fill?: boolean;
  /**
   * Swap the app's identity and section nav for a mode's own (see
   * {@link TopbarChrome}). Omitted on every ordinary page, which gets the cabinet
   * mark and the standard section links.
   */
  chrome?: TopbarChrome;
}

// The hamburger glyph for the mobile section-nav toggle. Sized to match the
// gear/bell controls via the shared `.menuToggle` rule below.
function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

// A close (×) glyph shown in place of the hamburger while the mobile menu is
// open, mirroring the open/closed state in the icon itself.
function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
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

// A bar-chart glyph for the analyze control, which enters the gg analysis UI.
function AnalyzeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <line x1="3" y1="21" x2="21" y2="21" />
      <rect x="5" y="12" width="3.5" height="7" />
      <rect x="10.25" y="7" width="3.5" height="12" />
      <rect x="15.5" y="14" width="3.5" height="5" />
    </svg>
  );
}

// A left-pointing arrow: the gg analysis chrome's brand control, which returns to
// the ordinary UI (it stands exactly where the cabinet mark does).
function BackArrowIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <line x1="20" y1="12" x2="5" y2="12" />
      <polyline points="11,18 5,12 11,6" />
    </svg>
  );
}

// A small person glyph for the account control: the signed-in account (or a
// sign-in prompt when logged out).
function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
    </svg>
  );
}

// The section nav. Defined once, in route order, so every page shares the same
// links and they all flow through `routes.ts` (never inline path literals). The
// About link is appended only on the static site (see below): the consoles
// surface configuration through the Settings gear instead.
const NAV_LINKS: ReadonlyArray<{
  label: string;
  to: string;
  end?: boolean;
}> = [
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
export function PageLayout({
  children,
  fill = false,
  chrome,
}: PageLayoutProps) {
  const { canExecute, ggData } = useGalleryData();
  // The analysis surface exists on a console (a live backend answers its queries) and on
  // the public site (the published snapshot ships a gg document corpus the browser
  // evaluates). Gated on the union, and it must stay the same condition the router mounts
  // the section on — a control leading to an unmounted route is a dead end.
  const hasGgData = ggData != null;
  // The consoles reach run configuration through the Settings gear; the static
  // site keeps the About link in the nav. Both surface the Settings gear — on
  // the site it opens the Appearance-only settings (the sun and feed-style
  // choices that used to live in the topbar toggle). The Other link (Game Jams +
  // Tournaments) is shown on every console — game jams are always available — and
  // is omitted on the static site, which shows About in its place.
  // A mode's chrome replaces the section nav wholesale (its own tabs); otherwise
  // the standard links apply.
  const navLinks =
    chrome?.links ??
    (canExecute
      ? [...NAV_LINKS, { label: "Other", to: routes.other() }]
      : [...NAV_LINKS, { label: "About", to: routes.about() }]);

  // The mobile section nav collapses behind a hamburger toggle. CSS owns which
  // presentation (inline row vs. dropdown sheet) is visible at a given width, so
  // this state only governs whether the *mobile* sheet is expanded; on desktop
  // the inline nav shows regardless. Close on every navigation so tapping a link
  // — or any other route change — dismisses the sheet.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const location = useLocation();
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const renderNavLinks = (onNavigate?: () => void) =>
    navLinks.map((link) => (
      <NavLink
        key={link.to}
        to={link.to}
        end={link.end ?? link.to === routes.home()}
        onClick={onNavigate}
        className={({ isActive }) =>
          isActive ? `${styles.navLink} ${styles.navActive}` : styles.navLink
        }
      >
        {link.label}
      </NavLink>
    ));

  return (
    <div
      className={fill ? `${styles.shell} ${styles.shellFill}` : styles.shell}
    >
      <header className={styles.topbar}>
        <div className={styles.bar}>
          {/* The brand control. In a mode's chrome it stands in the same place but
              leads back out of the mode, with a back arrow in place of the mark so
              the affordance is unmistakable. */}
          <Link
            to={chrome?.home ?? routes.home()}
            className={styles.brand}
            title={chrome?.back ? "Back to The Test Cabinet" : undefined}
          >
            {chrome?.back ? (
              <BackArrowIcon className={styles.mark} />
            ) : (
              <CabinetIcon className={styles.mark} />
            )}
            <span className={styles.wordmark}>
              {chrome?.label ?? "The Test Cabinet"}
            </span>
          </Link>
          {/* Desktop section nav: hidden at/below $bp-md, where the toggle takes
              over. Lives in the bar's middle, pushing the controls right. */}
          <nav className={`${styles.nav} ${styles.navInline}`}>
            {renderNavLinks()}
          </nav>
          <div className={styles.controls}>
            {/* The square glyph controls as one tight cluster, so they read as a
                set and leave room for the account control beside them. */}
            <div className={styles.iconControls}>
              {/* Analyze: enters the gg analysis UI (its own chrome and tabs). A
                  console lands on the Sessions index; the static site has no Sessions
                  tab (see `ggChrome`) and lands straight in Discover, which is the
                  whole of its analysis surface. */}
              {(canExecute || hasGgData) && (
                <NavLink
                  to={canExecute ? routes.ggAnalysis() : routes.ggAnalysisDiscover()}
                  className={exec.gear}
                  aria-label="Analyze gg runs"
                  title="Analyze gg runs"
                >
                  <AnalyzeIcon />
                </NavLink>
              )}
              {/* The notifications bell is a console-only affordance (runs only
                  complete where they can be launched); the static site omits it. */}
              {canExecute && <NotificationsBell />}
              <NavLink
                to={routes.settingsAppearance()}
                className={exec.gear}
                aria-label="Settings"
                title="Settings"
              >
                <GearIcon />
              </NavLink>
            </div>
            {/* The account control: view the signed-in account, or sign in. Like
                the bell it is console-only — the read-only static site has no
                accounts and never mounts the auth provider. Sits to the right of
                the Settings gear. */}
            {canExecute && <AccountMenu />}
            {/* Mobile-only: collapses the section nav behind a hamburger. Hidden
                above $bp-md so exactly one nav presentation shows at any width. */}
            <button
              type="button"
              className={styles.menuToggle}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              aria-controls={menuId}
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? <CloseIcon /> : <MenuIcon />}
            </button>
          </div>
        </div>
        {/* Mobile dropdown sheet: rendered only when open and only ever visible
            at/below $bp-md (the CSS hides it above). Stacks the links vertically
            beneath the bar. Tapping a link closes the sheet. */}
        {menuOpen && (
          <nav
            id={menuId}
            className={`${styles.nav} ${styles.navSheet}`}
            aria-label="Sections"
          >
            {renderNavLinks(() => setMenuOpen(false))}
          </nav>
        )}
      </header>
      <main
        className={fill ? `${styles.main} ${styles.mainFill}` : styles.main}
      >
        {children}
      </main>
    </div>
  );
}

// The topbar notifications bell: opens the slide-out notifications sidebar and
// shows an unread dot while any notification is unread. The notification list and
// sidebar state live in the shared `useNotifications` store, so this only reads
// the unread count and toggles the panel.
function NotificationsBell() {
  const unread = useNotifications(selectUnreadCount);
  const toggleSidebar = useNotifications((s) => s.toggleSidebar);
  const label =
    unread > 0 ? `Notifications (${unread} unread)` : "Notifications";
  return (
    <button
      type="button"
      className={styles.bell}
      onClick={toggleSidebar}
      aria-label={label}
      title={label}
    >
      <BellIcon />
      {unread > 0 && <span className={styles.bellDot} aria-hidden="true" />}
    </button>
  );
}

// The topbar account control: when signed in it links to the account page and
// shows the display name; when signed out it links to the sign-in page. The
// account/login/register pages own the actual sign-in, sign-out, and registration
// flows — this is just the entry point to them. Rendered only on the consoles
// (the auth provider is mounted there); the static site never shows it.
function AccountMenu() {
  const { account } = useAuth();
  if (account) {
    return (
      <NavLink
        to={routes.account()}
        className={styles.account}
        title={`Signed in as ${account.displayName} (@${account.username})`}
      >
        {/* Show the account's profile picture when one is set; otherwise the
            generic person glyph, as before. */}
        {account.pictureUrl ? (
          <Avatar
            name={account.displayName}
            pictureUrl={account.pictureUrl}
            size={24}
          />
        ) : (
          <PersonIcon />
        )}
        <span className={styles.accountName}>{account.displayName}</span>
      </NavLink>
    );
  }
  return (
    <NavLink to={routes.login()} className={styles.account} title="Sign in">
      <PersonIcon />
      <span className={styles.accountName}>Sign in</span>
    </NavLink>
  );
}
