"""构建静态站到 dist/（不启动服务）。已有 dist 时跳过，除非 --force。"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NAME = "build"
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


def node_env(node: str) -> dict[str, str]:
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


def main() -> int:
    parser = argparse.ArgumentParser(description="构建 Talk 静态站")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    dist = ROOT / "dist"
    marked = ROOT / "libs" / "marked" / "marked.esm.js"
    try:
        if not marked.is_file():
            raise FileNotFoundError(f"缺少本地 marked：{marked}")
        if dist.exists() and not args.force:
            print(f"[{NAME}] dist 已存在，跳过。重建请加 --force")
            return 0
        node = resolve_node()
        env = node_env(node)
        print(f"[{NAME}] 构建中…")
        subprocess.run([node, str(ROOT / "build.js")], cwd=ROOT, env=env, check=True)
        return 0
    except Exception as e:
        print(f"[{NAME}] {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
