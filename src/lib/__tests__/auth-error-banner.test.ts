import { describe, expect, test } from "vitest";
import { resolveAuthErrorKey } from "@/lib/auth/auth-errors";

describe("resolveAuthErrorKey", () => {
  test("maps the two known auth error codes", () => {
    expect(resolveAuthErrorKey("google_identity_required")).toBe("google_identity_required");
    expect(resolveAuthErrorKey("auth_callback")).toBe("auth_callback");
  });

  test("takes the first value of a repeated query param", () => {
    expect(resolveAuthErrorKey(["auth_callback", "google_identity_required"])).toBe(
      "auth_callback",
    );
  });

  test("rejects unknown, empty, and hostile values", () => {
    expect(resolveAuthErrorKey("auth_signin")).toBeNull();
    expect(resolveAuthErrorKey("<script>alert(1)</script>")).toBeNull();
    expect(resolveAuthErrorKey("")).toBeNull();
    expect(resolveAuthErrorKey(null)).toBeNull();
    expect(resolveAuthErrorKey(undefined)).toBeNull();
    expect(resolveAuthErrorKey([])).toBeNull();
  });
});
