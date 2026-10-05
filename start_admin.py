"""启动本地管理端（编辑 / 预览 / 自动保存）。不构建。"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PORT = 3456
NAME = "admin"
BLOCKED = ("cursor", "resources\\helpers", "resources/helpers")


def resolve_node() -> str:
    candidates: list[str] = []
    for key in ("NODE_BINARY",):
        v = os.environ.get(key)
        if v:
            candidates.append(v)
    for name in ("node.exe", "node"):
        which = shutil.which(name)
        if which:
            candidates.append(which)
    for entry in os.environ.get("PATH", "").split(os.pathsep):
        for name in ("node.exe", "node"):
            p = Path(entry) / name
            if p.is_file():
                candidates.append(str(p))

    seen: set[str] = set()
    for c in candidates:
        try:
            norm = os.path.normcase(str(Path(c).resolve()))
        except OSError:
            continue
        if norm in seen:
            continue
        seen.add(norm)
        if any(b in norm for b in BLOCKED):
            continue
        if Path(c).is_file():
            return str(Path(c).resolve())
    raise FileNotFoundError("未找到 Node.js：请安装并加入 PATH，或设置 NODE_BINARY")


def npm_env(node: str) -> dict[str, str]:
    env = os.environ.copy()
    node_dir = str(Path(node).parent)
    parts = [node_dir]
    for part in env.get("PATH", "").split(os.pathsep):
        if not part or any(b in os.path.normcase(part) for b in BLOCKED):
            continue
        if os.path.normcase(part) == os.path.normcase(node_dir):
            continue
        parts.append(part)
    env["PATH"] = os.pathsep.join(parts)
    return env


def open_browser(url: str) -> None:
    if os.name == "nt":
        try:
            subprocess.Popen(["cmd", "/c", "start", "", url])
            return
        except OSError:
            pass
    webbrowser.open(url)


def wait_until_ready(url: str, process: subprocess.Popen[str], timeout_s: float = 30.0) -> None:
    """Poll the live server until it answers, or the process exits."""
    deadline = time.monotonic() + timeout_s
    probe = f"{url.rstrip('/')}/api/config"
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"管理端进程已退出，exit={process.returncode}")
        try:
            with urllib.request.urlopen(probe, timeout=0.5) as resp:
                if 200 <= resp.status < 500:
                    return
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            pass
        time.sleep(0.1)
    raise TimeoutError(f"等待管理端就绪超时：{probe}")


def main() -> int:
    parser = argparse.ArgumentParser(description="启动猫咪的博客管理端")
    parser.add_argument("--port", type=int, default=PORT)
    parser.add_argument("--no-open", action="store_true")
    args = parser.parse_args()

    marked = ROOT / "libs" / "marked" / "marked.esm.js"
    if not marked.is_file():
        print(f"[{NAME}] 缺少本地 marked：{marked}", file=sys.stderr)
        return 1

    try:
        node = resolve_node()
        env = npm_env(node)
        env["PORT"] = str(args.port)
        url = f"http://localhost:{args.port}"
        print(f"[{NAME}] {url}")
        print(f"[{NAME}] node={node}")

        process = subprocess.Popen(
            [node, str(ROOT / "server.js")],
            cwd=ROOT,
            env=env,
        )
        try:
            wait_until_ready(url, process)
            print(f"[{NAME}] 已就绪")
            if not args.no_open:
                open_browser(url)
            return process.wait()
        except KeyboardInterrupt:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
            print(f"\n[{NAME}] 已停止")
            return 0
        except Exception:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
            raise
    except FileNotFoundError as e:
        print(f"[{NAME}] {e}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"[{NAME}] {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
