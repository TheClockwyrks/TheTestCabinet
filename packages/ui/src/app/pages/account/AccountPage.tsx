import { Navigate, useNavigate } from "react-router";
import { Panel } from "@test-cabinet/ui";
import { PageLayout } from "../../components/PageLayout";
import { useAuth } from "../../../client/auth";
import { routes } from "../../routes";
import styles from "./AccountPages.module.scss";

// The account view (`/account`): shows the signed-in user (display name +
// username) and a sign-out control. A console-only page; a signed-out visitor is
// redirected to the sign-in page. Signing out clears the stored token and returns
// to the gallery home.
export function AccountPage() {
  const { account, logout } = useAuth();
  const navigate = useNavigate();
  if (!account) return <Navigate to={routes.login()} replace />;
  return (
    <PageLayout>
      <div className={styles.page}>
        <Panel className={styles.card}>
          <h1 className={styles.title}>Account</h1>
          <dl className={styles.details}>
            <div className={styles.row}>
              <dt className={styles.term}>Display name</dt>
              <dd className={styles.value}>{account.displayName}</dd>
            </div>
            <div className={styles.row}>
              <dt className={styles.term}>Username</dt>
              <dd className={styles.value}>@{account.username}</dd>
            </div>
          </dl>
          <button
            type="button"
            className={styles.primary}
            onClick={() => {
              logout();
              navigate(routes.home());
            }}
          >
            Sign out
          </button>
        </Panel>
      </div>
    </PageLayout>
  );
}
