"""启动本地管理端（编辑 / 预览 / 自动保存）。不构建。"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import threading
import time
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


def ensure_deps(env: dict[str, str]) -> None:
    if (ROOT / "node_modules" / "marked").exists():
        return
    print(f"[{NAME}] 首次安装依赖…")
    npm = "npm.cmd" if os.name == "nt" else "npm"
    subprocess.run([npm, "install"], cwd=ROOT, env=env, check=True)


def open_browser(url: str) -> None:
    if os.name == "nt":
        try:
            subprocess.Popen(["cmd", "/c", "start", "", url])
            return
        except OSError:
            pass
    webbrowser.open(url)


def main() -> int:
    parser = argparse.ArgumentParser(description="启动 Talk 管理端")
    parser.add_argument("--port", type=int, default=PORT)
    parser.add_argument("--no-open", action="store_true")
    args = parser.parse_args()

    try:
        node = resolve_node()
        env = npm_env(node)
        env["PORT"] = str(args.port)
        ensure_deps(env)
        url = f"http://localhost:{args.port}"
        print(f"[{NAME}] {url}")
        print(f"[{NAME}] node={node}")
        if not args.no_open:
            threading.Thread(target=lambda: (time.sleep(0.8), open_browser(url)), daemon=True).start()
        subprocess.run([node, str(ROOT / "server.js")], cwd=ROOT, env=env, check=True)
        return 0
    except FileNotFoundError as e:
        print(f"[{NAME}] {e}", file=sys.stderr)
        return 1
    except subprocess.CalledProcessError as e:
        return e.returncode or 1
    except KeyboardInterrupt:
        print(f"\n[{NAME}] 已停止")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
