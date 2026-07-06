import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  handleOverlayDownload,
  type OverlayDownloadApiDeps,
  type OverlayPlatform,
} from "../api/downloads";
import type { EntitlementRow } from "../entitlements/core";

const ACTIVE_TESTER: EntitlementRow = {
  kind: "overlay_tester",
  status: "active",
  starts_at: "2026-07-06T00:00:00Z",
  expires_at: "2026-07-09T00:00:00Z",
};

function deps(overrides: Partial<OverlayDownloadApiDeps> = {}): OverlayDownloadApiDeps {
  return {
    getUser: async () => ({ id: "user-1" }),
    listEntitlements: async () => [ACTIVE_TESTER],
    artifactUrl: (platform: OverlayPlatform) =>
      platform === "windows"
        ? "https://downloads.example.test/windows.exe"
        : "https://downloads.example.test/mac.dmg",
    now: () => new Date("2026-07-06T12:00:00Z"),
    ...overrides,
  };
}

function get(platform: string): Request {
  return new Request(`https://wasfun.lol/api/downloads/overlay?platform=${platform}`);
}

describe("handleOverlayDownload", () => {
  test("unauthenticated users cannot access the download route", async () => {
    const response = await handleOverlayDownload(get("windows"), deps({
      getUser: async () => null,
    }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
  });

  test("signed-in users without active download entitlement cannot access downloads", async () => {
    const response = await handleOverlayDownload(get("windows"), deps({
      listEntitlements: async () => [],
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "none" });
  });

  test("expired tester access cannot access downloads", async () => {
    const response = await handleOverlayDownload(get("windows"), deps({
      listEntitlements: async () => [
        {
          ...ACTIVE_TESTER,
          expires_at: "2026-07-05T00:00:00Z",
        },
      ],
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "expired" });
  });

  test("active tester access redirects to the configured Windows artifact", async () => {
    const response = await handleOverlayDownload(get("windows"), deps());

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://downloads.example.test/windows.exe");
  });

  test("active tester access redirects to the configured Mac artifact", async () => {
    const response = await handleOverlayDownload(get("mac"), deps());

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://downloads.example.test/mac.dmg");
  });

  test("unauthorized responses do not expose configured artifact URLs", async () => {
    const response = await handleOverlayDownload(get("windows"), deps({
      getUser: async () => null,
      artifactUrl: () => "https://downloads.example.test/private-token.exe?token=secret",
    }));

    const body = await response.text();
    expect(body).not.toContain("downloads.example.test");
    expect(body).not.toContain("secret");
  });

  test("authorized users get a safe error when an artifact URL is not configured", async () => {
    const response = await handleOverlayDownload(get("mac"), deps({
      artifactUrl: () => null,
    }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "download-unavailable" });
  });

  test("invalid platforms are rejected", async () => {
    const response = await handleOverlayDownload(get("linux"), deps());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid-platform" });
  });
});

describe("account page overlay download wiring", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/app/[locale]/account/page.tsx"),
    "utf8",
  );

  test("renders download buttons only behind active overlay download entitlement", () => {
    expect(source).toContain("pickActiveOverlayDownloadEntitlement");
    expect(source).toContain("downloadVerdict.active");
    expect(source).toContain("/api/downloads/overlay?platform=windows");
    expect(source).toContain("/api/downloads/overlay?platform=mac");
  });

  test("does not render direct artifact environment variables in account HTML", () => {
    expect(source).not.toContain("MAYHEM_OVERLAY_WINDOWS_URL");
    expect(source).not.toContain("MAYHEM_OVERLAY_MAC_URL");
  });
});
