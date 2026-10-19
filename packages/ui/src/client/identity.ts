import { createContext, useContext } from "react";

// Who the console is acting as.
//
// The console holds no credential and presents no login form. A person signs in
// at the edge (Cloudflare Access) and the browser holds the Access cookie for the
// console's origin, which the edge turns into the assertion every service
// verifies; in development the Vite dev server adds the local identity header
// instead (components/auth/overview.md). Nothing here gates a request: the
// services decide who may do what from that assertion.
//
// What the console does need is to recognise its own work, such as the signed-in
// reviewer's own review on a run, which the backend attributes to the identity's
// email. The provider learns that email once from a resolver the host supplies.
// The provider lives in `identity-provider.tsx`. A host with no identity (the static gallery) mounts no provider, and an
// unresolved or failed lookup reads as "unknown": nothing is treated as the
// reader's own, and every control stays available, since the services are the
// ones that refuse a caller.

/** The identity the console is acting as. */
export interface IdentityContextValue {
  /** The signed-in person's email, or null when it is not known. */
  email: string | null;
}

/** Resolves the signed-in person's email, or null when there is none. */
export type IdentityResolver = () => Promise<string | null>;

const UNKNOWN: IdentityContextValue = { email: null };

/** The context {@link IdentityProvider} fills; read through {@link useIdentity}. */
export const IdentityContext = createContext<IdentityContextValue>(UNKNOWN);

// The path of the console's origin the edge answers with the signed-in person's
// identity as JSON (Cloudflare Access's `get-identity`); the development server
// answers it with the local identity it sends.
export const IDENTITY_PATH = "/cdn-cgi/access/get-identity";

/**
 * Read the signed-in person's email from {@link IDENTITY_PATH} of the page's own
 * origin. Best-effort: an unreachable endpoint, a non-2xx reply or a body with no
 * email resolves null.
 */
export async function fetchEdgeIdentity(): Promise<string | null> {
  try {
    const res = await fetch(IDENTITY_PATH, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { email?: unknown };
    return typeof body.email === "string" && body.email.trim() !== ""
      ? body.email
      : null;
  } catch {
    return null;
  }
}

/** The identity the console is acting as; unknown where no provider is mounted. */
export function useIdentity(): IdentityContextValue {
  return useContext(IdentityContext);
}
