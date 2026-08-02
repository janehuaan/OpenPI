import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

const TERMINAL_NAME = "OpenPI";

function resolveCliPath(): string {
	const configured = vscode.workspace.getConfiguration("openpi").get<string>("cliPath", "");
	if (configured) return configured;
	// Fall back to the monorepo dev script when the workspace is the repo.
	const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
	for (const folder of workspaceFolders) {
		const devScript = path.join(folder.uri.fsPath, "pi-test.sh");
		if (fs.existsSync(devScript)) {
			return devScript;
		}
	}
	return "pi";
}

function getOrCreateTerminal(): vscode.Terminal {
	const existing = vscode.window.terminals.find((terminal) => terminal.name === TERMINAL_NAME);
	if (existing) return existing;
	const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	return vscode.window.createTerminal({ name: TERMINAL_NAME, cwd });
}

export function activate(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand("openpi.openInTerminal", async () => {
			const cli = resolveCliPath();
			const resume = vscode.workspace.getConfiguration("openpi").get<boolean>("resume", true);
			const args = [cli];
			if (resume) args.push("--resume");
			const terminal = getOrCreateTerminal();
			terminal.show();
			terminal.sendText(args.join(" "));
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("openpi.sendSelection", async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) return;
			const selection = editor.selection;
			const text = editor.document.getText(selection);
			if (!text.trim()) {
				void vscode.window.showWarningMessage("No text selected.");
				return;
			}
			const cli = resolveCliPath();
			const prompt = text.includes("\n") ? `\`\`\`\n${text}\n\`\`\`` : text;
			const terminal = getOrCreateTerminal();
			terminal.show();
			terminal.sendText(`${cli} --print "${prompt.replace(/"/g, '\\"')}"`, true);
		}),
	);
}

export function deactivate(): void {
	// Nothing to clean up.
}
