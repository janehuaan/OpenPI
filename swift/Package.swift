// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "OpenPI",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .library(name: "OpenPIProtocol", targets: ["OpenPIProtocol"]),
        .executable(name: "openpi-daemon", targets: ["OpenPIDaemon"]),
        .executable(name: "OpenPIDesktop", targets: ["OpenPIDesktop"]),
        .executable(name: "openpi-test", targets: ["OpenPITests"])
    ],
    dependencies: [],
    targets: [
        .target(
            name: "OpenPIProtocol",
            dependencies: [],
            path: "Sources/OpenPIProtocol"
        ),
        .executableTarget(
            name: "OpenPIDaemon",
            dependencies: ["OpenPIProtocol"],
            path: "Sources/OpenPIDaemon"
        ),
        .executableTarget(
            name: "OpenPIDesktop",
            dependencies: ["OpenPIProtocol"],
            path: "Sources/OpenPIDesktop"
        ),
        .executableTarget(
            name: "OpenPITests",
            dependencies: ["OpenPIProtocol"],
            path: "Sources/OpenPITests"
        )
    ]
)
