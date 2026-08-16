import { Panel } from "@test-cabinet/ui";
import { Link, useLocation } from "react-router";
import { PageLayout } from "../../components/PageLayout";
import { useGalleryData } from "../../data/galleryContext";
import { routes } from "../../routes";
import styles from "./NotFoundPage.module.scss";

// The catch-all page: the URL addresses nothing this application routes.
//
// It is mounted last in the app's single <Routes>, so it answers exactly the
// paths no other route claimed. Before it existed those paths rendered *nothing*
// — the shell chrome wrapped around an empty body — which reads as a broken site
// rather than as a wrong address.
//
// On the static gallery the HTTP status is set separately, by
// `functions/_middleware.ts`, which answers an unrecognized path with a 404. This
// page and that status are deliberately two mechanisms: a client-side navigation
// never issues a request at all, so the page has to stand on its own, and a
// crawler needs the status because it does not run the app.
export function NotFoundPage() {
  const { pathname } = useLocation();
  const { canExecute } = useGalleryData();
  return (
    <PageLayout>
      <Panel>
        <div className={styles.wrap}>
          <p className={styles.code}>404</p>
          <h1 className={styles.heading}>Nothing at this address</h1>
          <p className={styles.detail}>
            The cabinet has no page at{" "}
            <code className={styles.path}>{pathname}</code>. It may have been a
            typo, or a link to something that has since moved.
          </p>
          <nav className={styles.links} aria-label="Somewhere to go instead">
            <Link to={routes.home()} className={styles.link}>
              Recent runs
            </Link>
            <Link to={routes.testCases()} className={styles.link}>
              Test cases
            </Link>
            <Link to={routes.runs()} className={styles.link}>
              All runs
            </Link>
            <Link to={routes.models()} className={styles.link}>
              Models
            </Link>
            {/* The About section is the static gallery's; the consoles put the
                same material behind the Settings gear and show Other instead,
                mirroring the top-bar nav. */}
            <Link
              to={canExecute ? routes.other() : routes.about()}
              className={styles.link}
            >
              {canExecute ? "Other" : "About"}
            </Link>
          </nav>
        </div>
      </Panel>
    </PageLayout>
  );
}
