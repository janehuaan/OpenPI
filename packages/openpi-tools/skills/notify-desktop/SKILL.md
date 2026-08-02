---
name: notify-desktop
description: Send a desktop notification via OpenPI notify adapter or OPENPI_NOTIFY_CLI.
---

# Desktop Notify

## Preferred command

```bash
node --experimental-strip-types packages/openpi-tools/scripts/notify.ts --title "OpenPI" --body "Done"
```

Or set:

```bash
export OPENPI_NOTIFY_CLI='terminal-notifier -title "{title}" -message "{body}"'
```

## Steps

1. Keep title/body short; never include secrets/tokens.
2. Run the adapter.
3. Confirm in chat that the notification was sent.
