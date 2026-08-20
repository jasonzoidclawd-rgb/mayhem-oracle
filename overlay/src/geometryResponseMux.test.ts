import { describe, expect, it, vi } from "vitest";
import { emptyGeometryObservation } from "./surfaceGeometry";
import { createGeometryResponseMux } from "./geometryResponseMux";

type Handler = (event: { payload: unknown }) => void;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

describe("createGeometryResponseMux", () => {
  it("accepts native-complete delivery before a delayed command response can starve replacements", async () => {
    const handlers = new Map<string, Handler>();
    const listen = vi.fn(async (event: string, handler: Handler) => {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    });
    const command1 = deferred<ReturnType<typeof emptyGeometryObservation>>();
    const command2 = deferred<ReturnType<typeof emptyGeometryObservation>>();
    const invoke = vi.fn()
      .mockReturnValueOnce(command1.promise)
      .mockReturnValueOnce(command2.promise);
    const mux = createGeometryResponseMux({ invoke, listen });
    await mux.start();

    const first = mux.probe(1, 10);
    const second = mux.probe(2, 20);

    handlers.get("geometry-native-complete")?.({
      payload: emptyGeometryObservation(2, 20, "second-native-finished"),
    });

    await expect(second).resolves.toMatchObject({
      source: "native-complete-event",
      observation: {
        probeSeq: 2,
        rejectionReasons: ["second-native-finished"],
      },
    });
    expect(await Promise.race([
      first.then(() => "resolved"),
      Promise.resolve("still-pending"),
    ])).toBe("still-pending");

    command1.resolve(emptyGeometryObservation(1, 10, "first-delayed-command"));
    command2.resolve(emptyGeometryObservation(2, 20, "second-delayed-command"));
    await mux.stop();
  });
});
