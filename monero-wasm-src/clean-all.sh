#!/bin/bash

rm -rf built || true
rm -rf built-* || true

git submodule update --init --recursive --force

rm -rf monero/translations/build || true