// One representation for every subprocess the dispatcher runs.
//
// spawnSync reports three different kinds of "it did not work" in three
// different fields: a launch that never happened (`error`), a run the kernel
// killed (`signal`), and a program that ran and exited nonzero (`status`).
// Reading `status` alone collapses all three into "the program said no", which
// is how a script that was never found comes back looking like that script's
// own verdict. Every consumer reads the same normalized shape instead:
//
//   { command, cwd, status, signal, stdout, stderr, error }
//
//   status   exit code, or null when the process never ran or was killed
//   signal   the signal that killed it, or null
//   stdout   captured text, always a string
//   stderr   captured text, always a string
//   error    { code, message } when the launch itself failed, else null
//
// This module runs commands and reports what happened. It decides nothing
// about what any particular failure means — that judgement belongs to the
// caller that knows what it asked for.

import { spawnSync } from "node:child_process";

const MAX_BUFFER = 64 * 1024 * 1024;

export function normalizeSpawnResult(answer, { command = [], cwd = null } = {}) {
  return {
    command: [...command],
    cwd,
    status: typeof answer?.status === "number" ? answer.status : null,
    signal: answer?.signal ?? null,
    stdout: answer?.stdout ?? "",
    stderr: answer?.stderr ?? "",
    error: answer?.error ? { code: answer.error.code ?? null, message: answer.error.message ?? String(answer.error) } : null,
  };
}

// True only when the program actually started and ran to its own exit. A
// launch that never happened and a process the kernel killed are both false.
export const didRun = (result) => result?.error == null && typeof result?.status === "number";

export function runProcess(command, { cwd, env, input, maxBuffer = MAX_BUFFER } = {}) {
  const answer = spawnSync(command[0], command.slice(1), {
    cwd,
    encoding: "utf8",
    env: env ? { ...process.env, ...env } : undefined,
    input,
    maxBuffer,
  });
  return normalizeSpawnResult(answer, { command, cwd: cwd ?? null });
}
