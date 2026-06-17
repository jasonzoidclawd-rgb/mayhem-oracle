import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export type CollectorConsent = "pending" | "accepted" | "declined";

export interface CollectorSnapshot {
  consent: CollectorConsent;
  paused: boolean;
  activeGame: boolean;
  exportedToday: number;
  dailyLimit: number;
  queuedBatches: number;
  lastError?: string;
}

interface CollectorStatusProps {
  onStatus: (status: CollectorSnapshot) => void;
}

export function CollectorStatus({ onStatus }: CollectorStatusProps) {
  const [status, setStatus] = useState<CollectorSnapshot | null>(null);

  const applyStatus = useCallback((next: CollectorSnapshot) => {
    setStatus(next);
    onStatus(next);
  }, [onStatus]);

  useEffect(() => {
    let cancelled = false;
    let running = false;

    const refresh = async (tick: boolean) => {
      if (running) return;
      running = true;
      try {
        const next = await invoke<CollectorSnapshot>(
          tick ? "collector_tick" : "get_collector_status",
        );
        if (!cancelled) applyStatus(next);
      } finally {
        running = false;
      }
    };

    void refresh(false);
    const interval = setInterval(() => void refresh(true), 5_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [applyStatus]);

  const setConsent = async (accepted: boolean) => {
    applyStatus(await invoke<CollectorSnapshot>("set_collector_consent", { accepted }));
  };

  const setPaused = async (paused: boolean) => {
    applyStatus(await invoke<CollectorSnapshot>("set_collector_paused", { paused }));
  };

  if (!status || status.consent === "pending") {
    return (
      <section className="collector-consent" role="dialog" aria-modal="true">
        <strong>Help improve Mayhem Oracle?</strong>
        <p>
          The collector uploads only de-identified Mayhem match fields. Riot IDs,
          PUUIDs, names, chat, and screenshots never leave this device.
        </p>
        <p>Declining disables both collection and the overlay.</p>
        <div className="collector-actions">
          <button onClick={() => void setConsent(true)}>Allow and continue</button>
          <button className="secondary" onClick={() => void setConsent(false)}>
            Decline
          </button>
        </div>
      </section>
    );
  }

  if (status.consent === "declined") {
    return (
      <section className="collector-panel">
        <strong>Collector and overlay disabled</strong>
        <button onClick={() => void setConsent(true)}>Enable</button>
      </section>
    );
  }

  return (
    <section className="collector-panel">
      <div className="collector-heading">
        <strong>Free collector</strong>
        <span>{status.activeGame ? "Paused in active game" : status.paused ? "Paused" : "Collecting"}</span>
      </div>
      <div className="collector-progress">
        <span>{status.exportedToday}/{status.dailyLimit} today</span>
        <span>{status.queuedBatches} queued</span>
      </div>
      {status.lastError && <span className="collector-error">{status.lastError}</span>}
      <button onClick={() => void setPaused(!status.paused)}>
        {status.paused ? "Resume" : "Pause"}
      </button>
    </section>
  );
}
