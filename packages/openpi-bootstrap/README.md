# @earendil-works/openpi-bootstrap

One-click enable + diagnose OpenPI packages in **user** settings (not baked into Pi core).

```bash
node --experimental-strip-types packages/openpi-bootstrap/src/cli.ts
node --experimental-strip-types packages/openpi-bootstrap/src/cli.ts --dry-run
node --experimental-strip-types packages/openpi-bootstrap/src/cli.ts verify
node --experimental-strip-types packages/openpi-bootstrap/src/cli.ts doctor
```

Writes:

- `~/.pi/agent/settings.json` — extension/skill absolute paths
- `~/.pi/agent/openpi.json` — product defaults + integrity hashes
- `~/.pi/agent/security.json` — default security mode (`confirm`)
- `~/.pi/agent/autostart/*` — launchd/systemd unit templates
