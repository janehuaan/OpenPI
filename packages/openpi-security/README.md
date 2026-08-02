# @earendil-works/openpi-security

Permission gate for bash/write/edit with CRITICAL/HIGH/MEDIUM/LOW levels and audit log.

```bash
pi -e packages/openpi-security/src/index.ts --security-gate-mode confirm
```

Modes: `strict` | `confirm` | `permissive`  
Commands: `/audit`
