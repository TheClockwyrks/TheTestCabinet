import { Navigate, useNavigate } from "react-router";
import { Panel } from "@test-cabinet/ui";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { useAuth } from "../../../client/auth";
import { routes } from "../../routes";
import { AccountTabs } from "./AccountTabs";
import styles from "./AccountPages.module.scss";

// The account view's Profile tab (`/account`): shows the signed-in user (display
// name + username) and a sign-out control, under the account section's tab strip
// (Profile / Coverage / Groups). A console-only page; a signed-out visitor is
// redirected to the sign-in page. Signing out clears the stored token and returns
// to the gallery home.
export function AccountPage() {
  const { account, logout } = useAuth();
  const navigate = useNavigate();
  if (!account) return <Navigate to={routes.login()} replace />;
  return (
    <PageLayout>
      <PromptHeader command="--account" comment={<>// your account</>} />
      <AccountTabs active="profile" />
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
