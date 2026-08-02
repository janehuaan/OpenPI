# @earendil-works/openpi-intelligence

Dynamic context selection, capability registry, structured planning, evaluation, and dynamic sub-agents.

Sub-agents spawn through the shared helper `src/spawn-pi.ts` (also usable by other packages).

```bash
pi -e packages/openpi-intelligence/src/index.ts
# or one-click: node --experimental-strip-types packages/openpi-bootstrap/src/cli.ts
```

```bash
npm test --workspace @earendil-works/openpi-intelligence
```

Config: `.pi/intelligence/config.json` (`enabled`, planning mode, budgets). See `src/config.ts`.
