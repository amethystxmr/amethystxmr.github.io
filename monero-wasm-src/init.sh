#!/bin/bash
set -euo pipefail

if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    git submodule update --init --recursive --force
else
    git submodule update --init --recursive
fi

(
    cd monero
    shopt -s nullglob
    for patch_file in ../patches/monero/*.patch; do
        if patch --batch --forward --dry-run -F 3 -p1 -i "${patch_file}" >/dev/null 2>&1; then
            patch --batch --forward -F 3 -p1 -i "${patch_file}"
        elif patch --batch --reverse --dry-run -F 3 -p1 -i "${patch_file}" >/dev/null 2>&1; then
            echo "Patch already applied: ${patch_file}"
        else
            echo "Failed to apply patch cleanly: ${patch_file}"
            exit 1
        fi
    done
)

(cd monero/contrib/depends && make download-linux)

(
    if command -v lrelease >/dev/null 2>&1; then
        LRELEASE_BIN="$(command -v lrelease)"
    elif command -v lrelease-qt5 >/dev/null 2>&1; then
        LRELEASE_BIN="$(command -v lrelease-qt5)"
    else
        if [ "$(id -u)" -eq 0 ]; then
            apt-get update
            apt-get install -y qttools5-dev-tools
        elif command -v sudo >/dev/null 2>&1; then
            sudo apt-get update
            sudo apt-get install -y qttools5-dev-tools
        else
            echo "lrelease is missing and sudo is not available; install qttools5-dev-tools manually."
            exit 1
        fi

        if command -v lrelease >/dev/null 2>&1; then
            LRELEASE_BIN="$(command -v lrelease)"
        elif command -v lrelease-qt5 >/dev/null 2>&1; then
            LRELEASE_BIN="$(command -v lrelease-qt5)"
        else
            echo "Failed to locate lrelease after installing qttools5-dev-tools."
            exit 1
        fi
    fi

    LRELEASE_PATH_DIR="$(dirname "${LRELEASE_BIN}")"
    cd monero/translations
    cmake -B build -DLRELEASE_PATH="${LRELEASE_PATH_DIR}"
    cd build
    make
    ./generate_translations_header
    pwd
    ls -la
)
