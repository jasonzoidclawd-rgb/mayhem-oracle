/**
 * Tauri IPC capability guard for the device-link window.
 *
 * Every window must be covered by a capability or the runtime denies all of
 * its `invoke()` calls outright, regardless of whether the target command
 * itself is permission-gated. DeviceLinkWindow invokes device_auth_status,
 * device_request_code, device_poll, and device_reset, and closes itself --
 * this guards that "device-link" stays covered, and stays least-privilege
 * (no window-creation permission it never uses).
 */
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const CAPABILITIES_DIR = new URL("../../src-tauri/capabilities/", import.meta.url);

function readCapabilities(): Array<{ identifier: string; windows: string[]; permissions: string[] }> {
  return readdirSync(CAPABILITIES_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => JSON.parse(readFileSync(new URL(file, CAPABILITIES_DIR), "utf8")));
}

describe("device-link window capability", () => {
  it("is covered by at least one capability", () => {
    const capabilities = readCapabilities();
    const covering = capabilities.filter((capability) => capability.windows.includes("device-link"));
    expect(covering.length, "no capability lists the device-link window").toBeGreaterThan(0);
  });

  it("grants the window permission to close itself", () => {
    const capabilities = readCapabilities();
    const covering = capabilities.filter((capability) => capability.windows.includes("device-link"));
    expect(covering.some((capability) => capability.permissions.includes("core:window:allow-close"))).toBe(true);
  });

  it("is not granted window-creation permission it never uses", () => {
    const capabilities = readCapabilities();
    const covering = capabilities.filter((capability) => capability.windows.includes("device-link"));
    for (const capability of covering) {
      expect(capability.permissions).not.toContain("core:webview:allow-create-webview-window");
    }
  });
});
