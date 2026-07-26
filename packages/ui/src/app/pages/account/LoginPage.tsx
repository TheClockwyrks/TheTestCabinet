import { Navigate, useSearchParams } from "react-router";
import { Panel } from "@test-cabinet/ui";
import { PageLayout } from "../../components/PageLayout";
import { useAuth } from "../../../client/auth";
import { routes } from "../../routes";
import { AuthForm } from "./AuthForm";
import styles from "./AccountPages.module.scss";

// The sign-in page (`/login`). A console-only page (the static site is read-only
// and provides no auth). An already-signed-in visitor is sent on to the `next`
// target (or the account view), so the page never shows a form to someone who is
// already authenticated.
export function LoginPage() {
  const { account } = useAuth();
  const [params] = useSearchParams();
  if (account) {
    return <Navigate to={params.get("next") || routes.home()} replace />;
  }
  return (
    <PageLayout>
      <div className={styles.page}>
        <Panel className={styles.card}>
          <h1 className={styles.title}>Sign in</h1>
          <p className={styles.lede}>
            Sign in to push, review, and publish runs. Your account attributes
            each review to you.
          </p>
          <AuthForm mode="login" />
        </Panel>
      </div>
    </PageLayout>
  );
}
