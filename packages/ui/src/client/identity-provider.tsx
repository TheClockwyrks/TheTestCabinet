import { useEffect, useState, type ReactNode } from "react";

import { IdentityContext, type IdentityResolver } from "./identity";

/** Supplies the identity the console is acting as to everything below it. */
export function IdentityProvider({
  resolve,
  children,
}: {
  resolve: IdentityResolver;
  children: ReactNode;
}) {
  // The answer is kept with the resolver it came from, so a new resolver reads as
  // unknown until it answers, without an effect having to clear it first.
  const [resolved, setResolved] = useState<{
    readonly from: IdentityResolver;
    readonly email: string | null;
  } | null>(null);
  useEffect(() => {
    const live = { active: true };
    void (async () => {
      let email: string | null = null;
      try {
        email = await resolve();
      } catch {
        // A failed lookup reads as unknown.
      }
      if (live.active) setResolved({ from: resolve, email });
    })();
    return () => {
      live.active = false;
    };
  }, [resolve]);
  const email = resolved?.from === resolve ? resolved.email : null;
  return (
    <IdentityContext.Provider value={{ email }}>
      {children}
    </IdentityContext.Provider>
  );
}
