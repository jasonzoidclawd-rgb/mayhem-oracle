// Where an executor's answer comes from, and where it does not.
//
// A runtime's captured output is diagnostic. It is whatever the model chose to
// print on the way to finishing: drafts, worked examples, the shape it was
// reasoning about rather than the answer it was asserting, and — when things go
// badly — a plausible report for a run that never happened. Reading a lifecycle
// result out of that means any object that happens to look like one becomes the
// run's disposition, its behavioral RED and its commit claim.
//
// So there is exactly one authoritative source, and it is a file the executor
// had to decide to write: `report-<role>.json` in that try's own handoff
// directory. The report path is handed to the executor in its packet, so
// writing it is an act, not an accident. An executor that did not write one did
// not answer, and "did not answer" is a fact the lifecycle knows how to handle —
// it is not a reason to go looking for something that resembles an answer.
//
// A reviewer is refused outright rather than merely unsupported: the executor
// owns its handoff directory, so `report-reviewer.json` there could only ever be
// a file the candidate placed to grade itself. A reviewer's verdict is read from
// its own output, which the executor cannot write to.
//
// Where that file lives is a separate question from who is allowed to speak, and
// confusing the two costs a whole executor turn. The handoff used to sit under
// the repository's own `.git`, which is a sensible place for a controller to
// keep run state and a hostile place to ask an agent to write: a runtime whose
// policy treats `.git` as off-limits will do the work, find it has nowhere to
// put the answer, and exit clean with nothing to show. That reads to the
// controller as an executor that declined to answer — the wrong conclusion about
// exactly the right rule.
//
// So the sink is an ordinary directory outside the repository, created by the
// controller before the turn is spent and proven writable while proving it is
// still cheap. The controller copies the raw bytes back into `.git` afterwards,
// so run history keeps what was actually written — including a file that would
// not parse, which is precisely the file a person debugging wants.

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// Outside every repository, by construction: a path under `.git` is a path some
// runtime is entitled to refuse.
export function reportSinkRoot() {
  return join(tmpdir(), "mayhem-dispatch-handoff");
}

const reportPath = (root, runId, role) => join(root, runId, `report-${role}.json`);

// Called once per try, before that try's executor is launched. Two tries never
// share a sink, because `runId` already distinguishes them; and a sink is
// emptied as it is created, so whatever is read back can only be a file this
// executor wrote.
export function createReportSink(root, runId, role) {
  if (role === "reviewer") {
    throw new Error("a reviewer writes no report; its verdict is read from its own output");
  }
  const path = reportPath(root, runId, role);
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  rmSync(path, { force: true });

  // The preflight. An unwritable sink is worth discovering now, when it costs a
  // file operation, rather than after an executor has done the work and has
  // nowhere to put it.
  const probe = join(dir, ".writable");
  try {
    writeFileSync(probe, "");
    rmSync(probe, { force: true });
  } catch (err) {
    throw new Error(`the executor's report sink is not writable: ${dir} — ${err.message}`);
  }
  return { dir, path };
}

// Run history belongs to the controller, so the controller is what writes it.
// The bytes are copied unread: this is the record of what the executor wrote,
// not a second opinion about what it meant.
export function archiveReport(root, runId, role, archiveDir) {
  const from = reportPath(root, runId, role);
  if (!existsSync(from) || statSync(from).size === 0) return null;
  const to = reportPath(archiveDir, runId, role);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  return to;
}

// Was the required report there when the process stopped? Presence and content
// are two questions: a file that exists and does not parse is not an answer
// either, but it is a different failure from one that was never written, and a
// person diagnosing a dead runtime needs to know which happened.
export function executorReportExists(root, runId, role) {
  if (role === "reviewer") return false;
  const path = reportPath(root, runId, role);
  return existsSync(path) && statSync(path).size > 0;
}

export function readExecutorReport(root, runId, role) {
  if (role === "reviewer") {
    throw new Error("a reviewer's verdict is read from its own output, never from the executor's run directory");
  }
  const path = reportPath(root, runId, role);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // A file that is not a report is not a report. There is nothing to fall
    // through to: an executor that wrote rubbish did not write an answer, and
    // the lifecycle treats that the same way it treats writing nothing.
    return null;
  }
}
