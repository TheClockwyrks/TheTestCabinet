import { Navigate, useSearchParams } from "react-router";
import { Panel } from "@test-cabinet/ui";
import { PageLayout } from "../../components/PageLayout";
import { useAuth } from "../../../client/auth";
import { routes } from "../../routes";
import { AuthForm } from "./AuthForm";
import styles from "./AccountPages.module.scss";

// The registration page (`/register`). A console-only page. Registration is open
// — anyone who can reach the auth service may create an account — and it signs the
// new user in, so an already-signed-in visitor is redirected on rather than shown
// the form.
export function RegisterPage() {
  const { account } = useAuth();
  const [params] = useSearchParams();
  if (account) {
    return <Navigate to={params.get("next") || routes.home()} replace />;
  }
  return (
    <PageLayout>
      <div className={styles.page}>
        <Panel className={styles.card}>
          <h1 className={styles.title}>Create an account</h1>
          <p className={styles.lede}>
            Registration is open to anyone who can reach the auth service. Your
            display name is shown beside the reviews you write.
          </p>
          <AuthForm mode="register" />
        </Panel>
      </div>
    </PageLayout>
  );
}
