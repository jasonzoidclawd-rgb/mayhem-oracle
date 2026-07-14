import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  ANALYTICS_EVENTS,
  resetAnalyticsSenderForTests,
  setAnalyticsSenderForTests,
  track,
} from "@/lib/analytics";

describe("analytics consent gate", () => {
  const getItem = vi.fn<() => string | null>();

  beforeEach(() => {
    vi.stubGlobal("window", {
      localStorage: { getItem },
    });
    getItem.mockReturnValue(null);
  });

  afterEach(() => {
    resetAnalyticsSenderForTests();
    vi.unstubAllGlobals();
  });

  test("does not call the provider without granted consent", () => {
    const sender = vi.fn();
    setAnalyticsSenderForTests(sender);

    expect(track("page_view")).toBe(false);
    expect(sender).not.toHaveBeenCalled();
  });

  test("calls the provider after granted consent", () => {
    const sender = vi.fn();
    setAnalyticsSenderForTests(sender);
    getItem.mockReturnValue("granted");

    expect(track("entity_search", { result_count: 3 })).toBe(true);
    expect(sender).toHaveBeenCalledWith("entity_search", { result_count: 3 });
  });

  test("exposes exactly the launch event allowlist", () => {
    expect(ANALYTICS_EVENTS).toEqual([
      "page_view",
      "entity_search",
      "champion_open",
      "augment_open",
      "overlay_cta_click",
      "signup_start",
      "signup_complete",
      "ad_slot_viewable",
    ]);
  });
});
