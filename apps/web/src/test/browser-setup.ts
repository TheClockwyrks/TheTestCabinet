// The setup every browser test file runs first. `vite.config.ts` names this
// file.
//
// The browser project exists to read what only a browser decides, so nothing
// here stands in for anything a browser supplies itself: no animation-frame
// clock, no observer and no laid-out box, all of which an engine has already.
// What is left is the same registration `setup.ts` beside it makes, which is
// why the two files are as short as each other.

// Testing Library's matchers, registered for every test file.
import "@testing-library/jest-dom/vitest";
