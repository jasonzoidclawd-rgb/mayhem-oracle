// A thin, argv-only wrapper around the authenticated `gh` CLI.
//
// No SDK, no token handling, no shell. Every call is an argument vector handed
// to an injected runner, so an issue body — which is attacker-influenced text —
// never becomes shell syntax and never reaches a command line at all: comment
// bodies travel on stdin. Any nonzero exit or unparseable payload is a hard
// failure, never an empty result treated as "nothing there".

export class GhError extends Error {}

const FIELDS = "number,title,body,state,labels,url";

export function createGh({ repo, run }) {
  if (!repo) throw new GhError("createGh needs the repository it speaks to");
  if (typeof run !== "function") throw new GhError("createGh needs an argv runner; it never opens a shell");

  const call = (argv, options = {}) => {
    const answer = run(argv, options);
    if (!answer || answer.status !== 0) {
      const detail = (answer?.stderr || answer?.stdout || "no output").trim();
      throw new GhError(`${argv[0]} ${argv[1]} exited ${answer?.status ?? "?"}: ${detail}`);
    }
    return answer.stdout ?? "";
  };

  const json = (argv) => {
    const raw = call(argv);
    try {
      return JSON.parse(raw);
    } catch {
      throw new GhError(`${argv[0]} ${argv[1]} returned unparseable JSON (${raw.slice(0, 120)})`);
    }
  };

  return {
    viewIssue(number) {
      return json(["issue", "view", String(number), "--repo", repo, "--json", FIELDS]);
    },
    listOpenIssues({ limit = 200 } = {}) {
      const list = json(["issue", "list", "--repo", repo, "--state", "open", "--limit", String(limit), "--json", FIELDS]);
      if (!Array.isArray(list)) throw new GhError("issue list did not return an array");
      return list;
    },
    repoLabels({ limit = 200 } = {}) {
      const list = json(["label", "list", "--repo", repo, "--limit", String(limit), "--json", "name"]);
      if (!Array.isArray(list)) throw new GhError("label list did not return an array");
      return list.map((l) => l.name);
    },
    // Only labels this harness defines are ever written, so nothing derived
    // from an issue body reaches argv here.
    setLabels(number, { add = [], remove = [] } = {}) {
      const argv = ["issue", "edit", String(number), "--repo", repo];
      for (const label of add) argv.push("--add-label", label);
      for (const label of remove) argv.push("--remove-label", label);
      if (argv.length === 4) return;
      call(argv);
    },
    comment(number, body) {
      call(["issue", "comment", String(number), "--repo", repo, "--body-file", "-"], { input: String(body) });
    },
  };
}
