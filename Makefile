# Em Windows use `make` do Git for Windows/MSYS ou rode scripts/build.ps1.
.PHONY: setup test build cli dev clean

setup:
	npm install

test:
	npm test
	cargo test --workspace -- --test-threads=1

cli:
	cargo build --release -p regente-cli

build: cli
	npx tauri build --no-bundle

dev:
	npx tauri dev

clean:
	cargo clean
	rm -rf dist
