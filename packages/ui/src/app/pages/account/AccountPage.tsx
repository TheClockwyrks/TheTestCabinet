import { useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { Avatar, Panel } from "@test-cabinet/ui";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { useAuth } from "../../../client/auth";
import { useWorkers } from "../../../client/context";
import { routes } from "../../routes";
import { AccountTabs } from "./AccountTabs";
import { downscaleToSquare } from "./downscalePicture";
import styles from "./AccountPages.module.scss";

// The account view's Profile tab (`/account`): shows the signed-in user (their
// avatar, display name, and username), lets them set/replace/remove a profile
// picture, and offers a sign-out control, under the account section's tab strip
// (Profile / Reviews / Coverage / Groups). A console-only page; a signed-out
// visitor is redirected to the sign-in page. Signing out clears the stored token
// and returns to the gallery home.
export function AccountPage() {
  const { account, logout, setProfilePicture, removeProfilePicture } =
    useAuth();
  const { active: worker } = useWorkers();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!account) return <Navigate to={routes.login()} replace />;

  // The active transport can only manage a picture when it implements the auth
  // calls; hide the controls otherwise (rather than offer a button that throws).
  const canManagePicture = !!worker?.client?.setProfilePicture;
  const hasPicture = !!account.pictureUrl;

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const picture = await downscaleToSquare(file);
      await setProfilePicture(picture);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      // Clear the input so re-picking the same file fires `change` again.
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const onRemove = async () => {
    setError(null);
    setBusy(true);
    try {
      await removeProfilePicture();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageLayout>
      <PromptHeader command="--account" comment={<>// your account</>} />
      <AccountTabs active="profile" />
      <div className={styles.page}>
        <Panel className={styles.card}>
          <h1 className={styles.title}>Account</h1>
          <div className={styles.identity}>
            <Avatar
              name={account.displayName}
              pictureUrl={account.pictureUrl}
              size={72}
            />
            {canManagePicture && (
              <div className={styles.pictureControls}>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  className={styles.hiddenInput}
                  onChange={(e) => void onPick(e.target.files?.[0])}
                />
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={busy}
                  onClick={() => fileInput.current?.click()}
                >
                  {hasPicture ? "Change picture" : "Add picture"}
                </button>
                {hasPicture && (
                  <button
                    type="button"
                    className={styles.linkButton}
                    disabled={busy}
                    onClick={() => void onRemove()}
                  >
                    Remove
                  </button>
                )}
              </div>
            )}
          </div>
          {error && <p className={styles.error}>{error}</p>}
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
