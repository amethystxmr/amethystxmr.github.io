# Amethyst XMR Monero wallet

## Building wasm module

(check CI for the most up-to-date instructions)

```bash
git submodule update --init --recursive

(cd monero && cat ../patches/* | patch -p1)

(cd monero/contrib/depends && make download-linux)

(
    sudo apt-get install qttools5-dev-tools
    cd monero/translations
    cmake -B build -DLRELEASE_PATH=/usr/bin
    cd build && make && ./generate_translations_header
)

```


## Building web

todo