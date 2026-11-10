#!/bin/sh
# Builds the contracts to wasm and runs unit + sandbox integration tests. Intended for the rust Docker image:
#   docker run --rm -v "$PWD:/work" -w /work rust:1 sh run-tests.sh
set -e
export CARGO_TARGET_DIR=${CARGO_TARGET_DIR:-/tmp/target}
rustup target add wasm32-unknown-unknown >/dev/null 2>&1 || true
cargo test -p hugshire-vault
cargo build -p hugshire-vault -p mock-usdc -p mock-rhea --target wasm32-unknown-unknown --release
WASM_DIR=$CARGO_TARGET_DIR/wasm32-unknown-unknown/release cargo test -p hugshire-integration -- --test-threads=1
