---
name: email-summary
description: Summarize recent email via OpenPI email adapter or OPENPI_EMAIL_CLI.
---

# Email Summary

Fetch recent inbox text and summarize for the user. Read-only unless the user explicitly asks to send mail.

## Preferred command

From the OpenPI monorepo:

```bash
node --experimental-strip-types packages/openpi-tools/scripts/email-fetch.ts --limit 20
```

Or set:

```bash
export OPENPI_EMAIL_CLI="himalaya envelope list"
# or: notmuch search --output=summary tag:inbox
```

## Steps

1. Run the adapter (or `$OPENPI_EMAIL_CLI`) with bash.
2. Summarize unread/important items with times and senders.
3. Do **not** send, delete, or archive mail unless the user explicitly confirms.
