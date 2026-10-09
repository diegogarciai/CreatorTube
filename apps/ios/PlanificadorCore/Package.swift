// swift-tools-version:5.9
import PackageDescription

// Lógica de negocio pura del Planificador para iOS. Es un port 1:1 de
// `packages/core` (TypeScript): si cambia una regla allá, cámbiala aquí y en
// las pruebas, que replican las de la web.
let package = Package(
    name: "PlanificadorCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "PlanificadorCore", targets: ["PlanificadorCore"]),
    ],
    targets: [
        .target(name: "PlanificadorCore"),
        .testTarget(name: "PlanificadorCoreTests", dependencies: ["PlanificadorCore"]),
    ]
)
