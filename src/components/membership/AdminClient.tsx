"use client";

import { useState } from "react";

interface AdminCopy {
  createMemberInvite: string;
  createTrialInvite: string;
  newCodeLabel: string;
  durationDaysLabel: string;
  revoke: string;
  actionFailed: string;
}

interface EntitlementSummary {
  id: string;
  user_id: string;
  kind: string;
  status: string;
  expires_at: string | null;
}

async function adminPost(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const response = await fetch("/api/admin/entitlements", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) return null;
  return (await response.json()) as Record<string, unknown>;
}

export function AdminConsole({
  copy,
  initialEntitlements,
}: {
  copy: AdminCopy;
  initialEntitlements: EntitlementSummary[];
}) {
  const [durationDays, setDurationDays] = useState("");
  const [newCode, setNewCode] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [rows, setRows] = useState(initialEntitlements);

  async function createInvite(kind: "member" | "trial") {
    setError("");
    setNewCode(null);
    const result = await adminPost({
      action: "create-invite",
      kind,
      memberDurationDays:
        kind === "member" && durationDays ? Number(durationDays) : undefined,
    });
    if (result && typeof result.code === "string") setNewCode(result.code);
    else setError(copy.actionFailed);
  }

  async function revoke(id: string) {
    setError("");
    const result = await adminPost({ action: "revoke", entitlementId: id });
    if (result) {
      setRows((current) =>
        current.map((row) => (row.id === id ? { ...row, status: "revoked" } : row)),
      );
    } else {
      setError(copy.actionFailed);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <label className="text-sm text-white/60">
          {copy.durationDaysLabel}
          <input
            value={durationDays}
            onChange={(event) => setDurationDays(event.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 outline-none focus:border-amber-400/60"
          />
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            onClick={() => createInvite("member")}
            className="flex-1 rounded-lg bg-amber-400/90 px-4 py-2.5 font-semibold text-black hover:bg-amber-300"
          >
            {copy.createMemberInvite}
          </button>
          <button
            onClick={() => createInvite("trial")}
            className="flex-1 rounded-lg border border-white/20 px-4 py-2.5 font-semibold hover:bg-white/5"
          >
            {copy.createTrialInvite}
          </button>
        </div>
        {newCode ? (
          <div className="rounded-lg border border-emerald-400/40 bg-emerald-400/10 p-3">
            <p className="text-xs uppercase tracking-widest text-emerald-300/80">
              {copy.newCodeLabel}
            </p>
            <p className="mt-1 select-all font-mono text-lg text-emerald-200">{newCode}</p>
          </div>
        ) : null}
        {error ? <p className="text-sm text-rose-300">{error}</p> : null}
      </div>

      <ul className="divide-y divide-white/5 rounded-2xl border border-white/10 bg-white/[0.03]">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center justify-between gap-3 p-3 text-sm">
            <span className="truncate">
              <span className="font-mono text-white/50">{row.user_id.slice(0, 8)}</span>{" "}
              <span className="capitalize">{row.kind}</span>{" "}
              <span className={row.status === "active" ? "text-emerald-300" : "text-rose-300"}>
                {row.status}
              </span>
            </span>
            {row.status === "active" ? (
              <button
                onClick={() => revoke(row.id)}
                className="shrink-0 rounded-md border border-rose-400/40 px-3 py-1 text-rose-300 hover:bg-rose-400/10"
              >
                {copy.revoke}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
