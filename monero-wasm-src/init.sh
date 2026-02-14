#!/bin/bash
set -e

git submodule update --init --recursive

(cd monero && cat ../patches/* | patch -p1)

(cd monero/contrib/depends && make download-linux)

(
    sudo apt-get install qttools5-dev-tools
    cd monero/translations
    cmake -B build -DLRELEASE_PATH=/usr/bin
    cd build && make && ./generate_translations_header
)