/**
 * electron-builder afterPack:
 * 1) copy openpi-runtime including nested node_modules (ditto)
 * 2) copy first-party openpi-* packages as a mini monorepo for extensions + desktop-ops
 * 3) prune unused node_modules from runtime (reduce bundle size)
 * 4) prune unnecessary dylibs from embedding directory
 */
const { execFileSync } = require("node:child_process");
const { existsSync, mkdirSync, rmSync, cpSync, readdirSync, statSync, unlinkSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const OPENPI_PACKAGES = [
	"openpi-memory",
	"openpi-tools",
	"openpi-intelligence",
];

// Packages to remove from runtime node_modules — zero source references, just bloat
const PRUNE_PACKAGES = [
	"@opentelemetry",
	"web-streams-polyfill",
	"protobufjs",
	"@modelcontextprotocol",  // MCP - not used in runtime
	"@mariozechner",           // markdown parsing - use native
	"@silvia-odwyer",          // audio processing - separate module
	"highlight.js",            // syntax highlighting - not needed at runtime
	"mammoth",                 // docx parsing - rare use case
	"pdf-parse",               // PDF parsing - rare use case
];

// Dylibs to keep in embedding/ (everything else is unused by llama-server)
const KEEP_EMBEDDING_LIBS = new Set([
	"llama-server",
	"libllama.dylib",
	"libllama.0.dylib",
	"libllama.0.0.10261.dylib",
	"libllama-common.dylib",
	"libllama-common.0.dylib",
	"libllama-common.0.0.10261.dylib",
	"libggml.dylib",
	"libggml.0.dylib",
	"libggml.0.18.0.dylib",
	"libggml-base.dylib",
	"libggml-base.0.dylib",
	"libggml-base.0.18.0.dylib",
	"libggml-cpu.dylib",
	"libggml-cpu.0.dylib",
	"libggml-cpu.0.18.0.dylib",
	"libggml-blas.dylib",
	"libggml-blas.0.dylib",
	"libggml-blas.0.18.0.dylib",
	"libggml-rpc.dylib",
	"libggml-rpc.0.dylib",
	"libggml-rpc.0.18.0.dylib",
]);

function dittoOrCp(src, dest) {
	rmSync(dest, { recursive: true, force: true });
	try {
		execFileSync("ditto", [src, dest], { stdio: "inherit" });
	} catch {
		cpSync(src, dest, { recursive: true });
	}
}

function copyPackageTree(monorepoRoot, destPackagesRoot) {
	mkdirSync(join(destPackagesRoot, "packages"), { recursive: true });
	for (const name of OPENPI_PACKAGES) {
		const src = join(monorepoRoot, "packages", name);
		if (!existsSync(src)) {
			console.warn(`afterPack: skip missing package ${name}`);
			continue;
		}
		const dest = join(destPackagesRoot, "packages", name);
		// Copy source tree but skip node_modules / dist bloat where possible
		rmSync(dest, { recursive: true, force: true });
		mkdirSync(dest, { recursive: true });
		for (const entry of readdirSync(src)) {
			if (entry === "node_modules" || entry === "dist" || entry === ".turbo") continue;
			const from = join(src, entry);
			const to = join(dest, entry);
			const st = statSync(from);
			if (st.isDirectory()) {
				cpSync(from, to, { recursive: true });
			} else {
				cpSync(from, to);
			}
		}
		console.log(`afterPack: packaged ${name}`);
	}
}

exports.default = async function afterPack(context) {
	const projectDir = context.packager.projectDir;
	const monorepoRoot = join(projectDir, "../..");
	const runtimeSrc = join(projectDir, "runtime");
	const marker = join(
		runtimeSrc,
		"node_modules",
		"@earendil-works",
		"pi-orchestrator",
		"dist",
		"cli.js",
	);

	const appName = context.packager.appInfo.productFilename;
	const resources =
		context.electronPlatformName === "darwin"
			? join(context.appOutDir, `${appName}.app`, "Contents", "Resources")
			: join(context.appOutDir, "resources");

	if (existsSync(marker)) {
		const dest = join(resources, "openpi-runtime");
		dittoOrCp(runtimeSrc, dest);
		console.log(`afterPack: copied openpi-runtime → ${dest}`);
		// Prune unused packages from runtime node_modules
		pruneNodeModules(dest);
		// Prune unnecessary dylibs from embedding
		pruneEmbeddingDylibs(join(resources, "embedding"));
		// Prune Electron locale.pak files (keep en + zh)
		pruneElectronLocales(context.appOutDir);
		// Prune GPU libraries (not needed for headless embedding server)
		pruneElectronGPULibs(context.appOutDir);
	} else {
		console.warn("afterPack: runtime missing; skip openpi-runtime copy");
	}

	// Mini monorepo for memory extension + desktop-ops + bootstrap
	const packagesDest = join(resources, "openpi-packages");
	rmSync(packagesDest, { recursive: true, force: true });
	copyPackageTree(monorepoRoot, packagesDest);
	console.log(`afterPack: openpi-packages → ${packagesDest}`);
};

function pruneNodeModules(runtimeDir) {
	const nodeModules = join(runtimeDir, "node_modules");
	if (!existsSync(nodeModules)) return;
	let freed = 0;
	for (const pkg of PRUNE_PACKAGES) {
		const pkgPath = join(nodeModules, pkg);
		if (!existsSync(pkgPath)) continue;
		try {
			const size = dirSize(pkgPath);
			rmSync(pkgPath, { recursive: true, force: true });
			freed += size;
			console.log(`afterPack: pruned ${pkg} (${formatSize(size)})`);
		} catch (e) {
			console.warn(`afterPack: failed to prune ${pkg}: ${e.message}`);
		}
	}
	if (freed > 0) console.log(`afterPack: freed ${formatSize(freed)} from node_modules`);
}

function pruneEmbeddingDylibs(embeddingDir) {
	if (!existsSync(embeddingDir)) return;
	// Keep only unversioned dylib names; remove versioned copies to save ~15 MB.
	// llama-server uses @rpath to resolve, so unversioned names are sufficient.
	const KEEP_CORE = new Set([
		"llama-server",
		"bge-small-zh-q8_0.gguf",
		// Only unversioned names — .0.dylib copies are redundant
		"libllama.dylib",
		"libllama-common.dylib",
		"libllama-server-impl.dylib",
		"libggml.dylib",
		"libggml-base.dylib",
		"libggml-cpu.dylib",
		"libggml-blas.dylib",
		"libggml-rpc.dylib",
		"libmtmd.dylib",
	]);
	let freed = 0;
	for (const entry of readdirSync(embeddingDir)) {
		if (KEEP_CORE.has(entry)) continue;
		const fullPath = join(embeddingDir, entry);
		const st = statSync(fullPath);
		if (!st.isFile()) continue;
		try { unlinkSync(fullPath); freed += st.size; } catch {}
	}
	if (freed > 0) console.log(`afterPack: freed ${formatSize(freed)} from embedding dylibs`);
}

function dirSize(dir) {
	let size = 0;
	for (const entry of readdirSync(dir, { recursive: true })) {
		const fullPath = join(dir, entry);
		try { size += statSync(fullPath).size; } catch {}
	}
	return size;
}

function formatSize(bytes) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function pruneElectronLocales(appOutDir) {
	const electronFramework = join(appOutDir, "OpenPI.app", "Contents", "Frameworks", "Electron Framework.framework", "Versions", "A", "Resources");
	if (!existsSync(electronFramework)) return;
	const KEEP_LOCALES = new Set(["en.lproj", "en_GB.lproj", "zh_CN.lproj", "zh_TW.lproj"]);
	let freed = 0;
	for (const entry of readdirSync(electronFramework)) {
		if (!entry.endsWith(".lproj")) continue;
		const pakPath = join(electronFramework, entry, "locale.pak");
		if (!existsSync(pakPath)) continue;
		if (KEEP_LOCALES.has(entry)) continue;
		try {
			const st = statSync(pakPath);
			unlinkSync(pakPath);
			freed += st.size;
			console.log(`afterPack: pruned ${entry}/locale.pak (${formatSize(st.size)})`);
		} catch (e) {
			console.warn(`afterPack: failed to prune ${entry}: ${e.message}`);
		}
	}
	if (freed > 0) console.log(`afterPack: freed ${formatSize(freed)} from Electron locales`);
}

function pruneElectronGPULibs(appOutDir) {
	const libDir = join(appOutDir, "OpenPI.app", "Contents", "Frameworks", "Electron Framework.framework", "Versions", "A", "Libraries");
	if (!existsSync(libDir)) return;
	const TO_REMOVE = ["libGLESv2.dylib", "libvk_swiftshader.dylib"];
	let freed = 0;
	for (const name of TO_REMOVE) {
		const path = join(libDir, name);
		if (!existsSync(path)) continue;
		try {
			const st = statSync(path);
			unlinkSync(path);
			freed += st.size;
			console.log(`afterPack: pruned ${name} (${formatSize(st.size)})`);
		} catch (e) {
			console.warn(`afterPack: failed to prune ${name}: ${e.message}`);
		}
	}
	if (freed > 0) console.log(`afterPack: freed ${formatSize(freed)} from GPU libs`);
}

function pruneEmbeddingDylibs(embeddingDir) {
	if (!existsSync(embeddingDir)) return;
	// Only keep the core dylibs that llama-server actually links against
	const KEEP_CORE = new Set([
		"llama-server",
		"bge-small-zh-q8_0.gguf",
		// Core libs (required by llama-server)
		"libllama.dylib", "libllama.0.dylib",
		"libllama-common.dylib", "libllama-common.0.dylib",
		"libllama-server-impl.dylib",
		"libggml.dylib", "libggml.0.dylib",
		"libggml-base.dylib", "libggml-base.0.dylib",
		"libggml-cpu.dylib", "libggml-cpu.0.dylib",
		"libggml-blas.dylib", "libggml-blas.0.dylib",
		"libggml-rpc.dylib", "libggml-rpc.0.dylib",
		"libmtmd.dylib", "libmtmd.0.dylib",
	]);
	let freed = 0;
	for (const entry of readdirSync(embeddingDir)) {
		if (KEEP_CORE.has(entry)) continue;
		const fullPath = join(embeddingDir, entry);
		const st = statSync(fullPath);
		if (!st.isFile()) continue;
		try {
			unlinkSync(fullPath);
			freed += st.size;
		} catch {}
	}
	if (freed > 0) console.log(`afterPack: freed ${formatSize(freed)} from embedding dylibs`);
}

// Copy pi-storage binary
function copyPiStorageBinary(resourcesDir) {
	const src = join(projectDir, "../pi-storage/target/release/pi-storage-cli");
	const dest = join(resourcesDir, "pi-storage-cli");
	if (existsSync(src)) {
		cpSync(src, dest, { recursive: true, force: true });
		console.log(`afterPack: copied pi-storage-cli → ${dest}`);
	}
}

// Copy pi-memsearch binary if it exists
function copyRustBinary(resourcesDir) {
	const src = join(projectDir, "../pi-memsearch/target/release/pi-memsearch");
	const dest = join(resourcesDir, "pi-memsearch");
	if (existsSync(src)) {
		cpSync(src, dest, { recursive: true, force: true });
		console.log(`afterPack: copied pi-memsearch → ${dest}`);
	} else {
		console.warn(`afterPack: pi-memsearch binary not found at ${src}`);
	}
}
