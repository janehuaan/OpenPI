---
name: calendar-today
description: Show today's calendar via OpenPI calendar adapter or OPENPI_CALENDAR_CLI.
---

# Calendar Today

List today's events and present a concise agenda.

## Preferred command

```bash
node --experimental-strip-types packages/openpi-tools/scripts/calendar-today.ts
```

Or set:

```bash
export OPENPI_CALENDAR_CLI="icalBuddy eventsToday"
# or: gcalcli agenda
```

## Steps

1. Run the adapter (or `$OPENPI_CALENDAR_CLI`) with bash.
2. Present times + titles; call out conflicts.
3. Do **not** create/modify events unless the user explicitly confirms.
