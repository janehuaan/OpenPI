import assert from "node:assert/strict";
import test from "node:test";
import { extractSymbolsFromSource, WorkspaceSymbolIndexer } from "@openpi/shared";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("extractSymbolsFromSource extracts TypeScript symbols accurately", () => {
	const tsCode = `
export interface UserProfile {
  name: string;
  age: number;
}

export type ThemeMode = "light" | "dark";

export enum LogLevel {
  Debug,
  Info,
}

export class AuthService {
  login() {}
}

export function validateUser(u: UserProfile): boolean {
  return true;
}

export const fetchSession = async () => {
  return {};
};
`;

	const symbols = extractSymbolsFromSource(tsCode, "src/auth.ts");
	const names = symbols.map((s) => s.name);

	assert.equal(names.includes("UserProfile"), true);
	assert.equal(names.includes("ThemeMode"), true);
	assert.equal(names.includes("LogLevel"), true);
	assert.equal(names.includes("AuthService"), true);
	assert.equal(names.includes("validateUser"), true);
	assert.equal(names.includes("fetchSession"), true);

	const iface = symbols.find((s) => s.name === "UserProfile");
	assert.equal(iface?.kind, "interface");

	const cls = symbols.find((s) => s.name === "AuthService");
	assert.equal(cls?.kind, "class");

	const fn = symbols.find((s) => s.name === "validateUser");
	assert.equal(fn?.kind, "function");
});

test("extractSymbolsFromSource extracts Python and Go symbols", () => {
	const pyCode = `
class NeuralNet:
    pass

def train_model(epochs):
    pass
`;
	const pySymbols = extractSymbolsFromSource(pyCode, "model.py");
	assert.equal(pySymbols.some((s) => s.name === "NeuralNet" && s.kind === "class"), true);
	assert.equal(pySymbols.some((s) => s.name === "train_model" && s.kind === "function"), true);

	const goCode = `
type Router struct {
  routes []string
}

func NewRouter() *Router {
  return &Router{}
}
`;
	const goSymbols = extractSymbolsFromSource(goCode, "router.go");
	assert.equal(goSymbols.some((s) => s.name === "Router" && s.kind === "struct"), true);
	assert.equal(goSymbols.some((s) => s.name === "NewRouter" && s.kind === "function"), true);
});

test("WorkspaceSymbolIndexer indexes workspace and finds symbols and references", () => {
	const tempDir = mkdtempSync(join(tmpdir(), "openpi-symbols-test-"));
	try {
		writeFileSync(
			join(tempDir, "service.ts"),
			`export class PaymentGateway {
  charge() { return true; }
}`,
		);
		writeFileSync(
			join(tempDir, "controller.ts"),
			`import { PaymentGateway } from "./service";
export function handleCheckout() {
  const gateway = new PaymentGateway();
  gateway.charge();
}`,
		);

		const indexer = new WorkspaceSymbolIndexer(tempDir);
		indexer.scanWorkspace();

		assert.equal(indexer.fileCount, 2);
		assert.equal(indexer.symbolCount >= 2, true);

		// Search for symbol
		const searchRes = indexer.search("Payment");
		assert.equal(searchRes.length >= 1, true);
		assert.equal(searchRes[0].name, "PaymentGateway");

		// Find references
		const refs = indexer.findReferences("PaymentGateway");
		assert.equal(refs.length >= 2, true); // definition + import + usage
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
});
