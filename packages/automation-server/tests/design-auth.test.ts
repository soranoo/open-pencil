import { describe, expect, test } from "bun:test";

process.env.SERVER_API_KEY = "test-server-api-key";
process.env.DESIGN_SIGNING_SECRET = "test-design-signing-secret";
process.env.FRONTEND_URL = "https://frontend.example.test/editor?mode=automation";

const { createSignedDesignUrl, getSignedDesignUrl, validateSignedDesignAccess } =
  await import("../src/design-auth.ts");

const designId = "00000000-0000-4000-8000-000000000001";

function accessInput(url: URL) {
  return {
    designId,
    design: url.searchParams.get("design"),
    key: url.searchParams.get("key"),
    expiry: url.searchParams.get("expiry"),
    permission: url.searchParams.get("permission"),
    sign: url.searchParams.get("sign"),
  };
}

describe("signed design URLs", () => {
  test("validates a URL generated for the configured frontend target", () => {
    const access = createSignedDesignUrl(designId, "read");
    const url = new URL(getSignedDesignUrl(access));

    expect(url.origin).toBe("https://frontend.example.test");
    expect(url.pathname).toBe("/editor");
    expect(validateSignedDesignAccess(accessInput(url))).toEqual(access);
  });

  test("rejects changes to the signed design access target", () => {
    const access = createSignedDesignUrl(designId, "write");
    const url = new URL(getSignedDesignUrl(access));

    for (const parameter of ["design", "key", "expiry", "permission"]) {
      const tamperedUrl = new URL(url);
      tamperedUrl.searchParams.set(
        parameter,
        parameter === "permission" ? "read" : `tampered-${parameter}`,
      );

      expect(validateSignedDesignAccess(accessInput(tamperedUrl))).toBeNull();
    }
  });

  test("requires the design binding before validating access", () => {
    const access = createSignedDesignUrl(designId, "read");
    const url = new URL(getSignedDesignUrl(access));
    url.searchParams.delete("design");

    expect(validateSignedDesignAccess(accessInput(url))).toBeNull();
  });
});
