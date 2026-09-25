.PHONY: all build test clean app

all: build

build:
	swift build -c release

test:
	swift run openpi-test

app:
	../scripts/package-swift-app.sh

clean:
	swift package clean
	rm -rf ../dist/OpenPI.app
