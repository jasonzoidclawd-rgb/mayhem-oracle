// What the controller saw of a runtime, kept where a person can read it later.
//
// The lifecycle already knows how to say that an execution ended without
// answering. What it could not say was *how*. A run that recorded "executor
// exited 1 without a report" was telling the truth and handing over nothing:
// the exit code, the launch line, and everything the process printed on its way
// out lived only in a terminal that had already scrolled, so the one question a
// person actually has — why 1? — had no durable answer anywhere.
//
// So every executor try leaves a controller-owned record of its own process.
// Three facts, kept apart because they are three:
//
//   process   what the controller observed of the execution
//   stdout    what the process printed
//   stderr    what the process printed on the error stream
//
// None of it is authority, and adding it must not create any. A report is still
// the only place an executor makes a claim (run/report.mjs), and captured
// output is still evidence about the process rather than about the work — a
// perfectly-formed lifecycle result printed to stdout is a string in a log file
// here, exactly as it was a string on a terminal before.
//
// It is also written down, which output on a terminal never was, so what may be
// written down is a real question. A credential the controller handed the
// runtime is the controller's to keep out: env values never reach the record,
// and the exact values injected into the launch are masked out of the captured
// streams. The argv is recorded as the shape the mechanism declared rather than
// as the rendered line, so a path naming somebody's home directory cannot get
// in through a substitution nobody thought about.

// Diagnostics are unbounded by nature and disk is not. The tail is kept,
// because that is where a process that died says why, and what was dropped is
// stated rather than left to look like the whole of it.
const MAX_LOG_BYTES = 256 * 1024;

// Operator-facing text. A launch failure's message can carry the absolute path
// it tried, which names the machine; one line, no paths, capped. A path a
// runtime quoted — `open '/Users/…'` is how node reports most of them — is the
// same path, so the opening delimiter counts as a boundary too.
export const detail = (text) =>
  String(text ?? "")
    .trim()
    .split("\n")[0]
    .replace(/(^|[\s'"`([{<])\/\S+/g, "$1<path>")
    .slice(0, 200);

// Shapes that are a credential wherever they appear, whoever printed them.
const TOKEN_SHAPES = [
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
];

// The controller knows exactly which values it handed this process, so it can
// mask exactly those rather than guessing at what a secret looks like. Short
// values are left alone: masking every occurrence of a three-character string
// destroys the log without protecting anything.
export function scrubSecrets(text, secrets = []) {
  let clean = String(text ?? "");
  for (const secret of secrets) {
    const value = String(secret ?? "");
    if (value.length >= 8) clean = clean.split(value).join("[redacted]");
  }
  for (const shape of TOKEN_SHAPES) clean = clean.replace(shape, "[redacted]");
  return clean;
}

const tail = (text) => {
  const full = String(text ?? "");
  return full.length <= MAX_LOG_BYTES
    ? { text: full, bytes: full.length, truncated: false }
    : {
        text: `[${full.length - MAX_LOG_BYTES} earlier characters dropped]\n${full.slice(-MAX_LOG_BYTES)}`,
        bytes: full.length,
        truncated: true,
      };
};

// The launch line as the mechanism declared it, never as it was rendered. A
// literal the mechanism wrote is the mechanism's own word and is kept; anything
// that came out of a substitution is replaced by the name of the substitution,
// because that is the part whose value the controller supplied. With no
// template there is nothing to tell the two apart, and every argument is
// treated as substituted — the stricter reading.
export function argvShape(argv, template = null) {
  return (argv ?? []).map((_, index) => {
    const slot = template?.[index];
    if (typeof slot !== "string") return "<arg>";
    return /\{\w+\}/.test(slot) ? slot.replace(/\{(\w+)\}/g, "<$1>") : slot;
  });
}

// How the process ended, in the terms the process contract already draws. The
// three fields spawnSync reports are three different facts, and reading `status`
// alone tells all of them as the third one.
//
//   launch-failed  the program never started
//   timeout        the controller's own deadline killed it
//   signal         something else killed it
//   exit           it ran to its own exit
export function classifyTermination(result) {
  if (result?.error?.code === "ETIMEDOUT") return "timeout";
  if (result?.error) return "launch-failed";
  if (result?.signal) return "signal";
  if (typeof result?.status === "number") return "exit";
  return "unknown";
}

// 1: the first shape. Bumped when a field changes meaning, so a later reader
// never interprets an old record with new rules.
export const PROCESS_SCHEMA = 1;

const stamp = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

// One executor try, described. `result` is the normalized spawn answer from
// run/process.mjs; everything else is what the controller decided before it.
export function describeExecution({
  role,
  runId,
  account,
  execution,
  runtime,
  model = null,
  effort = null,
  cwd = null,
  argv = [],
  template = null,
  env = {},
  result,
  startedAt = null,
  endedAt = null,
  reportPath = null,
  reportPresentAtExit = null,
}) {
  const secrets = Object.values(env ?? {});
  const out = tail(scrubSecrets(result?.stdout, secrets));
  const err = tail(scrubSecrets(result?.stderr, secrets));
  return {
    process: {
      schema: PROCESS_SCHEMA,
      role,
      runId,
      account,
      execution,
      runtime,
      model,
      effort,
      cwd,
      // The mechanism, plus the shape of what it was started with. Never the
      // rendered line: that carries the whole packet and every path in it.
      command: { mechanism: execution, argv: argvShape(argv, template) },
      // Names, never values. Which credentials were set is how a person tells a
      // missing one from a rejected one; what they were is not the controller's
      // to write down.
      envKeys: Object.keys(env ?? {}).sort(),
      startedAt: stamp(startedAt),
      endedAt: stamp(endedAt),
      durationMs: Number.isFinite(startedAt) && Number.isFinite(endedAt) ? endedAt - startedAt : null,
      // True only when the program actually started and ran to its own exit.
      didRun: result?.error == null && typeof result?.status === "number",
      exitStatus: typeof result?.status === "number" ? result.status : null,
      signal: result?.signal ?? null,
      termination: classifyTermination(result),
      launchError: result?.error ? { code: result.error.code ?? null, message: detail(result.error.message) } : null,
      // Where the answer was due, as an identifier relative to the run rather
      // than a path on this machine, and whether it was there when the process
      // stopped. `null` means the controller did not establish it, which is not
      // the same as establishing that it was absent.
      report: { path: reportPath, presentAtExit: reportPresentAtExit },
      stdoutBytes: out.bytes,
      stdoutTruncated: out.truncated,
      stderrBytes: err.bytes,
      stderrTruncated: err.truncated,
    },
    stdout: out.text,
    stderr: err.text,
  };
}
