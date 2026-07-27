import { readFileSync as readFileSyncRaw } from "node:fs";

const readFileSync = (path: string | URL, encoding: "utf8") =>
  readFileSyncRaw(path, encoding).replace(/\r\n/g, "\n");
import { describe, expect, it } from "vitest";

describe("Windows diagnostic privacy boundary", () => {
  const native = readFileSync(
    new URL("../../src-tauri/src/lib.rs", import.meta.url),
    "utf8",
  );
  const panel = readFileSync(
    new URL("./DevOverlayDiagnostics.tsx", import.meta.url),
    "utf8",
  );

  it("never duplicates OCR text into the native diagnostic payload", () => {
    expect(native).not.toContain("pub raw_text:");
    expect(native).toContain("pub text_recognized: bool");
    expect(panel).not.toContain("raw={diagnostic.");
    expect(panel).toContain("boundedDiagnosticHash(diagnostic.normalizedText)");
  });

  it("sanitizes Windows foreground identity before IPC", () => {
    const collect = native.indexOf("fn collect_foreground_state");
    const windows = native.indexOf('#[cfg(target_os = "windows")]\n    {', collect);
    const fallback = native.indexOf(
      '#[cfg(not(any(target_os = "macos", target_os = "windows")))]',
      windows,
    );
    const windowsBranch = native.slice(windows, fallback);
    for (const field of [
      "foreground_app_name: None",
      "foreground_owner_name: None",
      "foreground_window_title: None",
      "foreground_executable_path: None",
      "foreground_window_handle: None",
    ]) {
      expect(windowsBranch).toContain(field);
    }
    expect(windowsBranch).toContain("capture_target_generation:");
    expect(windowsBranch).toContain("platform_failure_reason:");
  });
});
