import { afterEach, describe, expect, it, vi } from "vitest";

import { styleNonce } from "./style-nonce";

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The suite has no DOM, so stand in the one query this module makes. The
 * selector matters as much as the answer: it is the contract the shell fills
 * in `apps/desktop/src/app-protocol.ts`.
 */
function documentWith(meta: Record<string, string> | null): void {
  vi.stubGlobal("document", {
    querySelector(selector: string) {
      if (selector !== 'meta[name="csp-nonce"]') return null;
      if (!meta) return null;
      return { getAttribute: (name: string) => meta[name] ?? null };
    },
  });
}

describe("styleNonce", () => {
  it("reads the nonce the shell published on the document", () => {
    documentWith({ content: "Zm9vYmFyYmF6" });
    expect(styleNonce()).toBe("Zm9vYmFyYmF6");
  });

  it("is empty in a browser, where no policy is served", () => {
    documentWith(null);
    expect(styleNonce()).toBe("");
  });

  it("is empty rather than undefined when the element carries no value", () => {
    documentWith({});
    expect(styleNonce()).toBe("");
  });
});
