import type { GeometryObservation } from "./surfaceGeometry";

type UnlistenFn = () => void;
type GeometryEvent = { payload: unknown };

export interface GeometryResponseMuxHost {
  invoke<T>(command: string, args: Record<string, unknown>): Promise<T>;
  listen(event: string, handler: (event: GeometryEvent) => void): Promise<UnlistenFn>;
}

export type GeometryDeliverySource = "native-complete-event" | "command-response";

export interface GeometryDelivery {
  observation: GeometryObservation;
  source: GeometryDeliverySource;
}

interface PendingProbe {
  resolve: (delivery: GeometryDelivery) => void;
  reject: (error: unknown) => void;
}

export const GEOMETRY_NATIVE_COMPLETE_EVENT = "geometry-native-complete";

function isGeometryObservation(value: unknown): value is GeometryObservation {
  return typeof value === "object" && value !== null &&
    typeof (value as { probeSeq?: unknown }).probeSeq === "number" &&
    Array.isArray((value as { cards?: unknown }).cards) &&
    Array.isArray((value as { rejectionReasons?: unknown }).rejectionReasons);
}

/**
 * Race the ordinary Tauri command response against a native-complete event that
 * carries the same observation. The first channel to deliver owns the probe;
 * the later duplicate is ignored so command-response/Promise continuation lag
 * cannot keep the geometry scheduler physically occupied after native work has
 * already finished.
 */
export function createGeometryResponseMux(host: GeometryResponseMuxHost) {
  const pending = new Map<number, PendingProbe>();
  let unlisten: UnlistenFn | null = null;

  const settle = (observation: GeometryObservation, source: GeometryDeliverySource): boolean => {
    const entry = pending.get(observation.probeSeq);
    if (!entry) return false;
    pending.delete(observation.probeSeq);
    entry.resolve({ observation, source });
    return true;
  };

  return {
    async start(): Promise<void> {
      if (unlisten) return;
      unlisten = await host.listen(GEOMETRY_NATIVE_COMPLETE_EVENT, (event) => {
        if (isGeometryObservation(event.payload)) settle(event.payload, "native-complete-event");
      });
    },

    async stop(): Promise<void> {
      if (!unlisten) return;
      unlisten();
      unlisten = null;
      for (const entry of pending.values()) {
        entry.reject(new Error("geometry-response-mux-stopped"));
      }
      pending.clear();
    },

    probe(probeSeq: number, capturedAt: number): Promise<GeometryDelivery> {
      const delivered = new Promise<GeometryDelivery>((resolve, reject) => {
        pending.set(probeSeq, { resolve, reject });
      });
      void host.invoke<GeometryObservation>("probe_augment_surface", { probeSeq, capturedAt })
        .then((observation) => { settle(observation, "command-response"); })
        .catch((error) => {
          const entry = pending.get(probeSeq);
          if (!entry) return;
          pending.delete(probeSeq);
          entry.reject(error);
        });
      return delivered;
    },
  };
}
