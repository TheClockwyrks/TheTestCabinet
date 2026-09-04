// Refract — the vitest project the CASE's validators run as. CASE-PROVIDED.
//
// A project of its own, separate from the build's `vitest.config.ts` at the
// workspace root. The two never mix: the build's config names `src/**/*.test.ts`
// and measures coverage over `src/`, so the tests a build wrote are counted and
// covered on their own, and the verdict rests on the checks in this directory
// alone. A build cannot reach the verdict by writing a test, and a case's check
// cannot flatter the build's coverage.
//
//   npx vitest run                                       # the build's own tests
//   npx vitest run --config validation/vitest.config.ts  # the case's validators
//
// Everything but the dials below is the shared validator harness's, because
// everything but the dials is what makes a staged validator project one shape the
// runner can drive: the project's name, the suites it collects, the scaffolding
// it loads, and the refusal to pass a run that collected nothing.
//
// THE ROOT IS THE WORKSPACE, NOT THIS DIRECTORY, so a validator addresses the
// build's output by the same relative path the build itself produced it at. It is
// computed HERE, from this file's own URL, rather than inside the package: the
// package is staged one directory deeper than this file, so anything derived from
// its own location would name the wrong tree.
//
// Imported from its own module rather than through the package's barrel, for the
// reason `globalSetup.ts` gives.

import { defineValidationConfig } from "./case-harness/vitest-config";

// NO DIALS, AND THE MINUTE THIS CASE USED TO NAME IS WHY THE PACKAGE'S DEFAULT IS
// WHAT IT IS. The reasoning behind that minute was sound as far as it went —
// Refract's pointer operations take effect the moment they are called, so even
// the whole campaign course or a twenty-five-board cascade sweep is a few hundred
// crossings into the page rather than thousands of real-time frames — and it was
// still measured to be wrong, because it was sized against a healthy machine. An
// allowance a correct build can cross is a defect in the check: nothing here is
// taken from the wall clock except the allowance itself, so crossing it turns
// "how busy the host was" into a lost point.
//
// Sixty seconds was such an allowance, and this case is where that was measured.
// On a host running nine of these projects at once (load average ~450), an
// unmodified reference lost FOUR points to it — `cascade/tier-ladder`,
// `cascade/sequence-is-endless`, `cascade/boards-meet-the-tier-floor` and
// `campaign/select-states` — at 66-76 s apiece against quiet times of 6-14 s.
// Nothing about those checks is unusual; a crossing costs 6 ms on an idle box and
// 90 ms on a loaded one, and a sweep that makes a few hundred of them is one busy
// host away from the same fate.
//
// The package's default is five minutes, set against that measured worst case
// rather than against a healthy machine, and against the one ceiling a validator
// project cannot move: the runner caps the WHOLE suite run at forty-five minutes
// (`VITEST_TIMEOUT`, `crates/core/src/vitest_validator.rs`). At load average ~650
// the slowest file here measured 170 s and the whole run 1 059 s of those 2 700,
// so five minutes — a ninth of the cap — can only be crossed by a file on a host
// where the run was already lost. The hook ceiling is the same figure for the
// same reason, and both are now taken from the package rather than restated
// here. `vitest-config.ts` states the measurements in full, including the worker
// count they were taken at.

export default defineValidationConfig({
  root: new URL("..", import.meta.url).pathname,
});
