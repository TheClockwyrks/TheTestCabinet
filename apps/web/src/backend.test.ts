import { afterEach, describe, expect, it } from "vitest";

import { BACKEND_GLOBAL, apiUrl, backendOrigin } from "./backend.ts";

afterEach(() => {
  // The key is computed, and `Reflect` removes it without the dynamic `delete`
  // the lint refuses.
  Reflect.deleteProperty(globalThis, BACKEND_GLOBAL);
});

describe("the backend origin", () => {
  it("is the page's own origin while nothing configured one", () => {
    expect(backendOrigin()).toBe("");
    expect(apiUrl("/api/healthz")).toBe("/api/healthz");
  });

  it("is the configured address, joined to the path by one slash", () => {
    window[BACKEND_GLOBAL] = "https://api.example.com";
    expect(apiUrl("/api/healthz")).toBe("https://api.example.com/api/healthz");
  });

  it("drops the trailing slashes and whitespace an address carries", () => {
    window[BACKEND_GLOBAL] = " https://api.example.com// ";
    expect(backendOrigin()).toBe("https://api.example.com");
  });
});
