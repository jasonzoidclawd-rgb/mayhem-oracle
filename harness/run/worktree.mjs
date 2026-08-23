// What the workspace was carrying when the gate ran, and whether the gate could
// reach any of it.
//
// The invariant is unchanged and worth stating plainly: a gate result describes
// the candidate commit plus the environment inputs the gate itself declares,
// and nothing else. A workspace holding uncommitted work means the gate tested
// something no commit contains, so a passing gate says nothing about the
// commit it was supposed to prove.
//
// What was wrong was the question. `git status --porcelain` was read as a
// single boolean, and emptiness is not the invariant — it is a proxy that fails
// in both directions. An attempt whose worktree held nothing but evidence
// artifacts from sixteen previous attempts was refused twice, on two correct
// canonical commits, because a directory of pinned traces and gate logs made
// the string non-empty. The same boolean would have said "clean" about a
// workspace whose contamination had been committed.
//
// So the question is asked properly: for each thing git reports, can it reach
// the gate?
//
//   tracked, modified   yes — the gate reads the working tree
//   staged              yes — same files, same reason
//   untracked           only if some suite discovers, imports, compiles or
//                       executes it
//
// The last one is not answerable from a filename, and it is not the
// controller's to guess. scripts/gate.sh already declares what each suite reads
// (`--authority`), because that is already the one place a suite is defined; it
// now also declares the roots no suite can reach, with the proof written beside
// them. Everything untracked outside those roots blocks, which keeps the
// default fail-closed: an unrecognized path is a path nobody has shown to be
// harmless.
//
// A declaration is still a claim, so it is checked rather than believed. A root
// that contains something the gate says it reads is not honored at all, and a
// file that matches a declared gate input blocks wherever it happens to sit —
// including inside a root whose name looks like evidence.

// Does this file fall under one of the declared paths? A trailing slash is a
// directory prefix; `*` matches within one segment and `**` spans them, so a
// suite whose tests sit beside its sources can name just the tests. Anything
// else is matched literally.
const quote = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function matchesAuthority(file, paths) {
  return (paths ?? []).some((path) => {
    if (path.endsWith("/")) return file.startsWith(path);
    if (!path.includes("*")) return file === path;
    const pattern = quote(path)
      // `/**/` spans zero or more directories, so src/**/*.test.* has to match
      // src/x.test.ts as readily as src/lib/x.test.ts.
      .replace(/\\\*\\\*\//g, "\u0000")
      .replace(/\\\*\\\*/g, "\u0001")
      .replace(/\\\*/g, "[^/]*")
      .replace(/\u0000/g, "(?:.*/)?")
      .replace(/\u0001/g, ".*");
    return new RegExp(`^${pattern}$`).test(file);
  });
}

// What a profile's PASS rests on, read off the trusted gate's own declaration.
// It is asked because it is already the one place a suite is defined; parsing
// it here keeps the answer from drifting into a second list.
//
//   tracked   files a commit diff can show a change to
//   runtime   ignored state the suite's tooling executes out of regardless
//   evidence  roots the suite cannot reach at all
export function parseAuthority(declared) {
  const kinds = { tracked: [], runtime: [], evidence: [] };
  for (const line of String(declared ?? "").split("\n")) {
    const [, kind, path] = line.split("\t");
    const named = path?.trim();
    if (!named || !kinds[kind?.trim()]) continue;
    kinds[kind.trim()].push(named);
  }
  return kinds;
}

// The literal directory a declared path is rooted at, with any glob tail
// removed. `.codex/skills/x/scripts/test_*.py` is rooted at
// `.codex/skills/x/scripts/`, and that is the part a containment question can
// be asked about.
//
// An input with no directory at all — `package.json`, `*.config.*` — is rooted
// at the repository, and "is this root inside the repository" is true of every
// root ever declared. So it answers null instead: containment is not the
// question those inputs can be asked, and treating "" as a prefix would refuse
// every root on the strength of a manifest sitting at the top level.
const literalRoot = (path) => {
  const cut = path.indexOf("*");
  const literal = cut === -1 ? path : path.slice(0, cut);
  const dir = literal.slice(0, literal.lastIndexOf("/") + 1);
  return dir || null;
};

// Which declared roots are actually honored, and which are refused and why.
//
// Two conditions, both of them checks on the declaration rather than trust in
// it. Every suite in the declaration must name the root — so a suite added
// later inherits no exemption that was never examined for it — and no path the
// gate says it reads may share a lineage with the root in either direction. A
// root containing a gate input would exempt the gate's own examiner; a root
// inside a gate input is a subtree of something already being read.
export function evidenceRoots(declared) {
  const rows = String(declared ?? "")
    .split("\n")
    .map((line) => line.split("\t").map((cell) => cell?.trim()))
    .filter(([suite, kind, path]) => suite && kind && path);
  const suites = [...new Set(rows.map(([suite]) => suite))];
  if (suites.length === 0) return { honored: [], refused: [] };

  const inputs = rows.filter(([, kind]) => kind === "tracked" || kind === "runtime").map(([, , path]) => path);
  const named = new Set(rows.filter(([, kind]) => kind === "evidence").map(([, , path]) => path));

  const honored = [];
  const refused = [];
  for (const root of [...named].sort()) {
    const missing = suites.filter(
      (suite) => !rows.some(([s, kind, path]) => s === suite && kind === "evidence" && path === root),
    );
    if (missing.length) {
      refused.push({ root, why: `not declared non-input by ${missing.join(", ")}` });
      continue;
    }
    const collision = inputs.find((input) => {
      if (input.startsWith(root)) return true;
      const dir = literalRoot(input);
      return dir !== null && root.startsWith(dir);
    });
    if (collision) {
      refused.push({ root, why: `the gate reads ${collision}` });
      continue;
    }
    honored.push(root);
  }
  return { honored, refused };
}

// `git status --porcelain` v1: two status characters, a space, then the path.
//
// A path git had to quote is left quoted and never matched against a root. Git
// quotes exactly the paths whose bytes would make this format ambiguous, so
// declining to interpret one costs an exemption and never grants one — the safe
// direction for a check whose whole job is to be conservative.
export function parsePorcelain(text) {
  const entries = [];
  for (const line of String(text ?? "").split("\n")) {
    if (line.length < 4) continue;
    let path = line.slice(3);
    // A rename or copy prints "old -> new". What is on disk is the new path.
    const arrow = path.indexOf(" -> ");
    if (arrow !== -1) path = path.slice(arrow + 4);
    entries.push({ index: line[0], worktree: line[1], path, quoted: path.startsWith('"') });
  }
  return entries;
}

// Everything git reported, sorted into what it means for the candidate.
export function classifyWorktree(porcelain, { evidenceRoots: roots = [], gateInputs = [] } = {}) {
  const trackedModified = [];
  const stagedModified = [];
  const untrackedBlocking = [];
  const untrackedEvidence = [];

  for (const { index, worktree, path, quoted } of parsePorcelain(porcelain)) {
    if (index === "?" && worktree === "?") {
      // Exempt only when the path is inside a root the gate declared it cannot
      // reach, and is not itself something the gate says it reads. The second
      // half matters: a root is a statement about a tree, and a file planted
      // inside one that matches a declared input is still an input.
      const exempt = !quoted && roots.some((root) => path.startsWith(root)) && !matchesAuthority(path, gateInputs);
      (exempt ? untrackedEvidence : untrackedBlocking).push(path);
      continue;
    }
    // Tracked, and different from the commit in one or both places. Both are
    // recorded, because "staged" and "not staged" are two different things for
    // whoever has to resolve it.
    if (index !== " " && index !== "?") stagedModified.push(path);
    if (worktree !== " " && worktree !== "?") trackedModified.push(path);
  }

  const blocking = [...new Set([...trackedModified, ...stagedModified, ...untrackedBlocking])];
  return {
    // Whether the gate tested this commit, which is the question that was
    // always being asked.
    cleanForCandidate: blocking.length === 0,
    // Whether `git status` was literally empty, which is a different question
    // and is answered separately rather than implied. A record that called a
    // workspace clean when it was not would be the same mistake facing the
    // other way.
    statusEmpty: !String(porcelain ?? "").trim(),
    trackedModified,
    stagedModified,
    untrackedBlocking,
    untrackedEvidence,
    untrackedEvidenceCount: untrackedEvidence.length,
    evidenceRoots: roots,
  };
}

// What this attempt found already here, and what appeared since. The rule does
// not change with the answer — untracked source blocks whoever left it, and
// evidence blocks nobody — but a rerouted executor being refused for its
// predecessor's leftovers is a different fact from one refused for its own, and
// a person reading the record needs to be able to tell them apart.
export function worktreeDelta(now, baseline) {
  const wasEvidence = new Set(baseline?.untrackedEvidence ?? []);
  const wasBlocking = new Set(baseline?.untrackedBlocking ?? []);
  return {
    evidenceInherited: (now.untrackedEvidence ?? []).filter((path) => wasEvidence.has(path)),
    evidenceNewSinceBaseline: (now.untrackedEvidence ?? []).filter((path) => !wasEvidence.has(path)),
    blockingInherited: (now.untrackedBlocking ?? []).filter((path) => wasBlocking.has(path)),
    blockingNewSinceBaseline: (now.untrackedBlocking ?? []).filter((path) => !wasBlocking.has(path)),
  };
}

// The one sentence an operator reads. "Uncommitted changes" was true of all
// three of these and told them apart from none of them, so the category comes
// first and the paths come with it.
export function blockingReason(state) {
  const parts = [];
  const say = (paths, what) => {
    if (!paths.length) return;
    const shown = paths.slice(0, 3).join(", ");
    parts.push(`${paths.length} ${what}${paths.length > 3 ? ` (${shown}, …)` : ` (${shown})`}`);
  };
  say(state.stagedModified, "staged in the index");
  say(state.trackedModified, "tracked and modified");
  say(state.untrackedBlocking, "untracked and not in a declared non-input root");
  const carried = state.untrackedEvidenceCount
    ? `; ${state.untrackedEvidenceCount} untracked evidence path(s) were permitted`
    : "";
  return `the workspace carries changes the gate ran on but this commit does not contain: ${parts.join("; ")}${carried}`;
}
