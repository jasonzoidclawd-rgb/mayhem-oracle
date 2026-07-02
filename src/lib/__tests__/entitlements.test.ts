import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  evaluateEntitlement,
  hashInviteCode,
  pickActiveEntitlement,
  type EntitlementRow,
} from "../entitlements/core";
import { requireActiveEntitlement, type EntitlementClient } from "../entitlements/server";

const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20260613_membership_platform.sql",
);
const TRIAL_RESERVE_MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20260702_trial_reserve_rpc.sql",
);

function migrationSql(): string {
  return readFileSync(MIGRATION_PATH, "utf8").toLowerCase();
}

function trialReserveMigrationSql(): string {
  return readFileSync(TRIAL_RESERVE_MIGRATION_PATH, "utf8").toLowerCase();
}

/** Policy statements for one table, so we can assert what each table allows. */
function policiesFor(sql: string, table: string): string[] {
  return sql
    .split("create policy")
    .slice(1)
    .map((block) => block.split(";")[0])
    .filter((statement) => statement.includes(`on public.${table}`));
}

describe("membership migration structure", () => {
  const tables = [
    "profiles",
    "entitlements",
    "invite_codes",
    "invite_redemptions",
    "devices",
    "referral_progress",
    "decision_sessions",
    "decision_feedback",
    "model_releases",
  ];

  test("creates all nine membership tables", () => {
    const sql = migrationSql();
    for (const table of tables) {
      expect(sql, `missing create table for ${table}`).toContain(
        `create table public.${table}`,
      );
    }
  });

  test("row level security is enabled on every table", () => {
    const sql = migrationSql();
    for (const table of tables) {
      expect(sql, `RLS not enabled on ${table}`).toContain(
        `alter table public.${table} enable row level security`,
      );
    }
  });

  test("invite codes are stored hashed, never plaintext", () => {
    const sql = migrationSql();
    expect(sql).toContain("code_hash text not null unique");
    // No bare plaintext `code` column on invite_codes.
    const inviteTable = sql.split("create table public.invite_codes")[1]?.split(";")[0] ?? "";
    expect(inviteTable).not.toMatch(/\n\s+code\s+text/);
  });

  test("invite codes have a fixed kind: member or trial", () => {
    expect(migrationSql()).toMatch(/kind in \('member',\s*'trial'\)/);
  });

  test("users cannot write entitlements: only select policies exist", () => {
    const blocks = policiesFor(migrationSql(), "entitlements");
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    for (const block of blocks) {
      expect(block, "entitlements policy must be read-only").toContain("for select");
      expect(block).not.toContain("for insert");
      expect(block).not.toContain("for update");
      expect(block).not.toContain("for delete");
    }
  });

  test("users cannot write invite_codes or model_releases", () => {
    const sql = migrationSql();
    for (const table of ["invite_codes", "model_releases"]) {
      for (const block of policiesFor(sql, table)) {
        expect(block, `${table} policy must be read-only`).toContain("for select");
      }
    }
  });

  test("own-row read policies are keyed to auth.uid()", () => {
    const sql = migrationSql();
    for (const table of ["entitlements", "devices", "decision_sessions", "referral_progress"]) {
      const blocks = policiesFor(sql, table);
      expect(
        blocks.some((block) => block.includes("auth.uid()")),
        `${table} needs an auth.uid()-scoped policy`,
      ).toBe(true);
    }
  });

  test("trial grants are unique per account + device", () => {
    const referral = migrationSql().split("create table public.referral_progress")[1]?.split(";")[0] ?? "";
    expect(referral).toMatch(/unique\s*\(user_id,\s*device_id\)/);
  });

  test("decision sessions bound mode and round to the engine contract", () => {
    const sql = migrationSql();
    expect(sql).toMatch(/mode in \('competitive',\s*'exploration'\)/);
    expect(sql).toMatch(/round between 1 and 4/);
  });

  test("redemption is a security-definer function, not client-side writes", () => {
    const sql = migrationSql();
    expect(sql).toContain("create or replace function public.redeem_invite");
    expect(sql).toContain("security definer");
  });

  test("trial credit reservations are atomic and same-hash idempotent", () => {
    const sql = trialReserveMigrationSql();
    const existingReservationBranch =
      sql.split("reserved_game_hash = p_game_hash")[1]?.split("credits_consumed < credits_granted")[0] ?? "";
    const consumptionBranch =
      sql.split("credits_consumed < credits_granted")[1]?.split("end;")[0] ?? "";

    expect(sql).toContain("create or replace function public.reserve_trial_credit");
    expect(sql).toContain("security definer");
    expect(sql).toContain("for update");
    expect(existingReservationBranch).toContain("reserved_at >= v_stale_cutoff");
    expect(existingReservationBranch).toContain("return jsonb_build_object");
    expect(existingReservationBranch).not.toContain("credits_consumed = credits_consumed + 1");
    expect(consumptionBranch).toContain("if not found then");
    expect(consumptionBranch).toContain("return null");
    expect(consumptionBranch).toContain("credits_consumed = credits_consumed + 1");
    expect(consumptionBranch).toContain("reserved_game_hash = p_game_hash");
  });

  test("trial finalization keeps long games consumed and refunds verified short games", () => {
    const sql = trialReserveMigrationSql();
    const finalize = sql.split("create or replace function public.finalize_trial_credit")[1] ?? "";

    expect(finalize).toContain("p_duration_seconds < 480");
    expect(finalize).toContain("credits_consumed = greatest(credits_consumed - 1, 0)");
    expect(finalize).toContain("reserved_game_hash = null");
    expect(finalize).toContain("reserved_at = null");
    expect(finalize).not.toContain("credits_consumed = credits_consumed + 1");
  });
});

describe("evaluateEntitlement", () => {
  const now = new Date("2026-06-13T12:00:00Z");
  const base: EntitlementRow = {
    kind: "member",
    status: "active",
    starts_at: "2026-06-01T00:00:00Z",
    expires_at: null,
  };

  test("no row means inactive", () => {
    expect(evaluateEntitlement(null, now)).toEqual({ active: false, reason: "none" });
  });

  test("revoked rows are inactive", () => {
    expect(evaluateEntitlement({ ...base, status: "revoked" }, now)).toEqual({
      active: false,
      reason: "revoked",
    });
  });

  test("expired rows are inactive", () => {
    expect(
      evaluateEntitlement({ ...base, expires_at: "2026-06-12T00:00:00Z" }, now),
    ).toEqual({ active: false, reason: "expired" });
  });

  test("future rows are not active yet", () => {
    expect(
      evaluateEntitlement({ ...base, starts_at: "2026-07-01T00:00:00Z" }, now),
    ).toEqual({ active: false, reason: "not-started" });
  });

  test("an active member with no expiry is active", () => {
    expect(evaluateEntitlement(base, now)).toEqual({ active: true, kind: "member" });
  });

  test("an unexpired trial is active with its kind", () => {
    expect(
      evaluateEntitlement(
        { ...base, kind: "trial", expires_at: "2026-06-20T00:00:00Z" },
        now,
      ),
    ).toEqual({ active: true, kind: "trial" });
  });

  test("pickActiveEntitlement prefers member over trial", () => {
    const rows: EntitlementRow[] = [
      { ...base, kind: "trial", expires_at: "2026-06-20T00:00:00Z" },
      base,
    ];
    const verdict = pickActiveEntitlement(rows, now);
    expect(verdict.active).toBe(true);
    expect(verdict.active && verdict.entitlement.kind).toBe("member");
  });

  test("pickActiveEntitlement reports the most useful inactive reason", () => {
    const verdict = pickActiveEntitlement(
      [{ ...base, expires_at: "2026-06-12T00:00:00Z" }],
      now,
    );
    expect(verdict).toEqual({ active: false, reason: "expired" });
  });
});

describe("hashInviteCode", () => {
  test("is a deterministic sha-256 hex digest", () => {
    const a = hashInviteCode("MAYHEM-2026");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteCode("MAYHEM-2026")).toBe(a);
  });

  test("normalizes whitespace and case so a valid code redeems regardless of typing", () => {
    expect(hashInviteCode("  MAYHEM-2026 ")).toBe(hashInviteCode("MAYHEM-2026"));
    expect(hashInviteCode("mayhem-2026")).toBe(hashInviteCode("MAYHEM-2026"));
  });
});

describe("requireActiveEntitlement", () => {
  function fakeClient(options: {
    user: { id: string } | null;
    rows?: EntitlementRow[];
    error?: { message: string } | null;
  }): EntitlementClient {
    return {
      auth: {
        getUser: async () => ({
          data: { user: options.user as { id: string; email?: string } | null },
        }),
      },
      from: () => ({
        select: () => ({
          eq: async () => ({ data: options.rows ?? [], error: options.error ?? null }),
        }),
      }),
    };
  }

  test("unauthenticated requests are rejected with 401", async () => {
    const result = await requireActiveEntitlement({ client: fakeClient({ user: null }) });
    expect(result).toMatchObject({ ok: false, status: 401, reason: "unauthenticated" });
  });

  test("authenticated users without entitlements get 403 with a reason", async () => {
    const result = await requireActiveEntitlement({
      client: fakeClient({ user: { id: "u1" }, rows: [] }),
    });
    expect(result).toMatchObject({ ok: false, status: 403, reason: "none" });
  });

  test("expired entitlements get 403/expired, not a silent pass", async () => {
    const result = await requireActiveEntitlement({
      client: fakeClient({
        user: { id: "u1" },
        rows: [
          {
            kind: "member",
            status: "active",
            starts_at: "2026-01-01T00:00:00Z",
            expires_at: "2026-02-01T00:00:00Z",
          },
        ],
      }),
    });
    expect(result).toMatchObject({ ok: false, status: 403, reason: "expired" });
  });

  test("active members pass with user and entitlement attached", async () => {
    const result = await requireActiveEntitlement({
      client: fakeClient({
        user: { id: "u1" },
        rows: [
          { kind: "member", status: "active", starts_at: "2026-01-01T00:00:00Z", expires_at: null },
        ],
      }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.id).toBe("u1");
      expect(result.entitlement.kind).toBe("member");
    }
  });

  test("lookup failures fail closed with 403", async () => {
    const result = await requireActiveEntitlement({
      client: fakeClient({ user: { id: "u1" }, error: { message: "boom" } }),
    });
    expect(result).toMatchObject({ ok: false, status: 403, reason: "lookup-failed" });
  });
});
