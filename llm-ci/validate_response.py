#!/usr/bin/env python3
"""Validate LLM CI stdout: exactly OK, or one or more FAIL: lines — nothing else."""

import re
import sys
from pathlib import Path


def main() -> int:
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "response.txt")
    raw = path.read_text(encoding="utf-8", errors="replace")
    lines = [ln.strip() for ln in raw.splitlines() if ln.strip() != ""]
    if not lines:
        print("LLM CI: empty or whitespace-only model output.", file=sys.stderr)
        return 1
    if lines == ["OK"]:
        return 0
    if any(ln == "OK" for ln in lines):
        print("LLM CI: OK must be the only non-empty line.", file=sys.stderr)
        return 1
    fail_re = re.compile(r"^FAIL:")
    for ln in lines:
        if not fail_re.match(ln):
            print(f"LLM CI: invalid line (expected OK alone or only FAIL: lines): {ln!r}", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
