# OpenPI VS Code Extension

Minimal integration for the [pi coding agent](https://pi.dev) / OpenPI:

- **OpenPI: Open pi in Terminal** — starts (or reuses) an integrated terminal
  running `pi --resume` in the current workspace.
- **OpenPI: Send Selection to pi** — runs the selected editor text through
  `pi --print` in the terminal (context menu: "Send Selection to pi" when text
  is selected).

## Configuration

| Setting | Default | Description |
|---|---|---|
| `openpi.cliPath` | `""` | Absolute path to the pi CLI. Empty resolves `./pi-test.sh` when the workspace is the OpenPI repo, else `pi` from PATH. |
| `openpi.resume` | `true` | Pass `--resume` when opening the terminal session. |

## Development

```bash
npm install          # installs @types/vscode and typescript
npm run compile      # tsc -p . -> out/
```

Then press F5 in VS Code to launch the Extension Development Host.

## Publishing

Not published to the marketplace; load locally via Extension Development Host
or `code --install-extension` on a packaged `.vsix` (`npx @vscode/vsce package`).
