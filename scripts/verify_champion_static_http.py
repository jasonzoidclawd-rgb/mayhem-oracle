#!/usr/bin/env python3
"""Build and probe the production champion static-delivery contract."""

from __future__ import annotations

import json
import os
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN_PORTS = {3000, 3001, 3113, 3114}
DUMMY_ENV = {
    "NEXT_PUBLIC_SUPABASE_URL": "https://dummy.supabase.co",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY": "dummy-anon-key",
}


class VerificationError(RuntimeError):
    pass


@dataclass(frozen=True)
class Probe:
    label: str
    path: str
    expected_status: int
    body_markers: tuple[str, ...]
    user_agent: str | None = None
    require_all_markers: bool = True


PROBES = (
    Probe("champion invalid en", "/champions/zzz-not-real", 404, ("This page could not be found", "NEXT_HTTP_ERROR_FALLBACK;404"), require_all_markers=False),
    Probe("champion invalid zh-TW", "/zh-TW/champions/zzz-not-real", 404, ("This page could not be found", "NEXT_HTTP_ERROR_FALLBACK;404"), require_all_markers=False),
    Probe("champion Locke", "/champions/locke", 200, ("Locke", "Statistics not yet available for this patch")),
    Probe("champion Ahri", "/champions/ahri", 200, ("Ahri",)),
    Probe("augment invalid en", "/augments/zzz-not-real", 404, ("This page could not be found", "NEXT_HTTP_ERROR_FALLBACK;404"), require_all_markers=False),
    Probe("augment invalid zh-TW", "/zh-TW/augments/zzz-not-real", 404, ("This page could not be found", "NEXT_HTTP_ERROR_FALLBACK;404"), require_all_markers=False),
    Probe("item invalid en", "/items/9999999", 404, ("This page could not be found", "NEXT_HTTP_ERROR_FALLBACK;404"), require_all_markers=False),
    Probe("item invalid zh-TW", "/zh-TW/items/9999999", 404, ("This page could not be found", "NEXT_HTTP_ERROR_FALLBACK;404"), require_all_markers=False),
    Probe("champion invalid Googlebot", "/champions/zzz-not-real", 404, ("This page could not be found", "NEXT_HTTP_ERROR_FALLBACK;404"), user_agent="Googlebot/2.1 (+http://www.google.com/bot.html)", require_all_markers=False),
    Probe("member endpoint anonymous", "/api/champions/ahri/member-view?locale=en", 401, ("unauthenticated",)),
    Probe("member endpoint invalid", "/api/champions/zzz-not-real/member-view?locale=en", 404, ("unknown-champion",)),
)


def run_checked(command: list[str], env: dict[str, str]) -> None:
    print(f"$ {' '.join(command)}", flush=True)
    result = subprocess.run(command, cwd=ROOT, env=env)
    if result.returncode != 0:
        raise VerificationError(f"command failed with exit {result.returncode}: {' '.join(command)}")


def choose_unused_port() -> int:
    for _ in range(20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as candidate:
            candidate.bind(("127.0.0.1", 0))
            port = candidate.getsockname()[1]
        if port not in FORBIDDEN_PORTS:
            return port
    raise VerificationError("could not select an unused non-forbidden port")


def listener_pids(port: int) -> list[int]:
    result = subprocess.run(
        ["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"],
        text=True,
        capture_output=True,
    )
    if result.returncode not in (0, 1):
        raise VerificationError(f"lsof listener check failed: {result.stderr.strip()}")
    return [int(value) for value in result.stdout.split() if value.isdigit()]


def process_cwd(pid: int) -> Path:
    result = subprocess.run(
        ["lsof", "-a", "-p", str(pid), "-d", "cwd", "-Fn"],
        text=True,
        capture_output=True,
        check=True,
    )
    values = [line[1:] for line in result.stdout.splitlines() if line.startswith("n")]
    if len(values) != 1:
        raise VerificationError(f"could not prove cwd for listener PID {pid}")
    return Path(values[0]).resolve()


def is_descendant(pid: int, ancestor: int) -> bool:
    current = pid
    for _ in range(20):
        if current == ancestor:
            return True
        result = subprocess.run(
            ["ps", "-p", str(current), "-o", "ppid="],
            text=True,
            capture_output=True,
        )
        if result.returncode != 0 or not result.stdout.strip().isdigit():
            return False
        parent = int(result.stdout.strip())
        if parent <= 1 or parent == current:
            return False
        current = parent
    return False


def wait_for_listener(port: int, owner_pid: int, log_path: Path) -> tuple[int, Path]:
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        pids = listener_pids(port)
        if pids:
            if len(pids) != 1:
                raise VerificationError(f"port {port} has multiple listener PIDs: {pids}")
            listener = pids[0]
            cwd = process_cwd(listener)
            if not is_descendant(listener, owner_pid):
                raise VerificationError(
                    f"port {port} listener PID {listener} is unrelated to started PID {owner_pid}"
                )
            if cwd != ROOT.resolve():
                raise VerificationError(
                    f"port {port} listener PID {listener} cwd is {cwd}, expected {ROOT.resolve()}"
                )
            return listener, cwd
        time.sleep(0.1)
    log = log_path.read_text(encoding="utf-8", errors="replace") if log_path.exists() else ""
    raise VerificationError(f"server never bound port {port}; log:\n{log}")


def fetch(base_url: str, probe: Probe) -> tuple[int, dict[str, str], str]:
    headers = {"User-Agent": probe.user_agent} if probe.user_agent else {}
    request = urllib.request.Request(base_url + probe.path, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.status, {key.lower(): value for key, value in response.headers.items()}, response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as response:
        return response.code, {key.lower(): value for key, value in response.headers.items()}, response.read().decode("utf-8", "replace")


def verify_probe(base_url: str, probe: Probe) -> dict[str, str | int]:
    status, headers, body = fetch(base_url, probe)
    if status != probe.expected_status:
        raise VerificationError(
            f"{probe.label}: expected HTTP {probe.expected_status}, got {status}"
        )
    present = [marker for marker in probe.body_markers if marker in body]
    markers_ok = len(present) == len(probe.body_markers) if probe.require_all_markers else bool(present)
    if not markers_ok:
        raise VerificationError(
            f"{probe.label}: expected {'all' if probe.require_all_markers else 'one'} "
            f"body marker(s) {probe.body_markers}, found {present}"
        )
    if probe.expected_status == 404 and status == 200:
        raise VerificationError(f"{probe.label}: not-found body was wrapped in HTTP 200")
    result: dict[str, str | int] = {
        "label": probe.label,
        "path": probe.path,
        "status": status,
    }
    if probe.label in {"champion Locke", "champion Ahri"}:
        cache_control = headers.get("cache-control", "")
        prerender = headers.get("x-nextjs-prerender", "")
        if "s-maxage=" not in cache_control or prerender != "1":
            raise VerificationError(
                f"{probe.label}: static cache headers missing; "
                f"Cache-Control={cache_control!r}, x-nextjs-prerender={prerender!r}"
            )
        result["cache_control"] = cache_control
        result["x_nextjs_prerender"] = prerender
    return result


def stop_owned_server(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=5)


def main() -> int:
    env = os.environ.copy()
    env.update(DUMMY_ENV)
    server: subprocess.Popen[bytes] | None = None
    port: int | None = None
    try:
        stale = subprocess.run(
            ["pgrep", "-af", "next-server|next start|next dev"],
            text=True,
            capture_output=True,
        )
        print("preflight next processes:\n" + (stale.stdout.strip() or "(none)"))
        run_checked(["npm", "run", "build"], env)
        run_checked([sys.executable, "scripts/check_champion_static_imports.py"], env)
        run_checked([sys.executable, "scripts/check_prerender_manifest.py"], env)

        port = choose_unused_port()
        if listener_pids(port):
            raise VerificationError(f"selected port {port} became occupied before launch")
        with tempfile.NamedTemporaryFile(prefix="champion-static-server-", suffix=".log", delete=False) as log:
            log_path = Path(log.name)
            server = subprocess.Popen(
                ["npm", "run", "start", "--", "--port", str(port)],
                cwd=ROOT,
                env=env,
                stdout=log,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        listener_pid, listener_cwd = wait_for_listener(port, server.pid, log_path)
        print(
            f"listener proof: port={port} pid={listener_pid} "
            f"cwd={listener_cwd} owner_pid={server.pid}"
        )
        base_url = f"http://127.0.0.1:{port}"
        results = [verify_probe(base_url, probe) for probe in PROBES]
        print(json.dumps(results, indent=2, sort_keys=True))
        return 0
    except (OSError, subprocess.CalledProcessError, VerificationError) as exc:
        print(f"champion static HTTP verification FAILED: {exc}", file=sys.stderr)
        return 1
    finally:
        if server is not None:
            stop_owned_server(server)
        if port is not None and listener_pids(port):
            print(
                f"champion static HTTP verification FAILED: owned server cleanup left port {port} occupied",
                file=sys.stderr,
            )


if __name__ == "__main__":
    raise SystemExit(main())
