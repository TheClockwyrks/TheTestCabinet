import { Route } from "react-router";
import { NotFoundPage } from "./NotFoundPage";

// The catch-all route. Mounted LAST in the app's single <Routes> so it claims
// only the paths no section's routes matched — react-router ranks a `*` splat
// below every other pattern regardless of order, but keeping it last says so.
//
// This is the whole not-found story on the client. The HTTP *status* for a
// first-load request is set separately by the gallery's Pages middleware; see
// `NotFoundPage` for why the two are separate mechanisms.
export function notFoundRoutes() {
  return <Route path="*" element={<NotFoundPage />} />;
}
