# Agent Intelligence Layer V1

## 1. Goal

Build an extension-first intelligence layer on top of Pi. Pi remains responsible for model execution, tools, sessions, compaction, and UI. The intelligence layer decides:

- which context is relevant;
- which capabilities should be active;
- whether a task needs a structured plan;
- how plan nodes depend on one another;
- why each decision was made.

V1 must improve context selection and task planning without modifying Pi's agent loop.

## 2. V1 Scope

V1 contains four modules:

1. Intelligence Contract
2. Dynamic Context Engine
3. Skill Registry
4. Dynamic Planner

V1 also includes an event ledger, budgets, permissions, and deterministic fallbacks.

### Non-goals

V1 does not implement:

- autonomous reflection loops;
- automatic plan execution;
- agent evolution;
- vector databases or embeddings;
- distributed workers;
- unrestricted background agents;
- automatic writes to long-term memory;
- core Pi changes.

The planner produces an executable DAG contract, but V1 executes nodes only through existing Pi behavior or explicit tools. Dynamic sub-agent scheduling belongs to V2.

## 3. Verified Pi Extension Capabilities

The current API provides the required V1 hooks:

- `before_agent_start`: inspect the user prompt, inspect loaded context/skills, and replace the system prompt for a turn.
- `context`: modify `AgentMessage[]` before each LLM call.
- `session_before_compact`: cancel or replace compaction output.
- `getAllTools()`: read complete tool descriptors, parameter schemas, guidelines, and source metadata.
- `getActiveTools()` / `setActiveTools()`: inspect and select active tools.
- `getCommands()`: discover slash commands and distinguish extension, prompt, and skill commands.
- `exec()`: run bounded local retrieval commands.
- `appendEntry()`: persist structured session events.

Skills are also available through `before_agent_start.systemPromptOptions.skills`. Therefore V1 does not require a core API change.

## 4. Package Layout

```text
packages/coding-agent/examples/extensions/intelligence-layer/
  index.ts
  contract.ts
  config.ts
  registry.ts
  planner.ts
  context/
    engine.ts
    budget.ts
    ranker.ts
    dedupe.ts
    redact.ts
    sources/
      code.ts
      git.ts
      memory.ts
      knowledge.ts
      conversation.ts
  storage/
    run-store.ts
    event-ledger.ts
  commands/
    context.ts
    intelligence.ts
  tools/
    context-status.ts
    context-pin.ts
    context-exclude.ts
    plan.ts
```

Keep the extension entry thin. Each module owns one contract and can be unit tested without loading Pi.

## 5. Intelligence Contract

Use string unions, not enums. All persisted schemas include a version.

```typescript
export type ContextSourceKind = "conversation" | "code" | "git" | "memory" | "knowledge" | "web";
export type CapabilityKind = "tool" | "skill" | "command";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type PlanNodeStatus = "pending" | "ready" | "running" | "completed" | "failed" | "blocked";

export interface ContextCandidate {
  id: string;
  source: ContextSourceKind;
  uri: string;
  title: string;
  content: string;
  contentHash: string;
  estimatedTokens: number;
  metadata: Record<string, string | number | boolean>;
  provenance: {
    adapter: string;
    observedAt: string;
    revision?: string;
  };
}

export interface ContextScore {
  lexical: number;
  symbol: number;
  dependency: number;
  recency: number;
  attention: number;
  authority: number;
  tokenPenalty: number;
  total: number;
  reasons: string[];
}

export interface SelectedContext {
  candidate: ContextCandidate;
  score: ContextScore;
  mode: "full" | "excerpt" | "summary";
  selectedContent: string;
  selectedTokens: number;
  pinned: boolean;
}

export interface CapabilityDescriptor {
  id: string;
  kind: CapabilityKind;
  name: string;
  description: string;
  source: string;
  active: boolean;
  tags: string[];
  risk: RiskLevel;
  estimatedCost: number;
  sideEffects: string[];
  inputSchema?: unknown;
}

export interface PlanNode {
  id: string;
  title: string;
  objective: string;
  dependencies: string[];
  capabilityIds: string[];
  contextQueries: string[];
  contextItemIds: string[];
  risk: RiskLevel;
  successCriteria: string[];
  status: PlanNodeStatus;
  maxAttempts: number;
  timeoutMs: number;
}

export interface TaskPlan {
  version: 1;
  id: string;
  goal: string;
  mode: "direct" | "planned";
  nodes: PlanNode[];
  globalSuccessCriteria: string[];
  contextBudget: ContextBudget;
  createdAt: string;
}

export interface ContextBudget {
  totalTokens: number;
  reservedForConversation: number;
  reservedForCompletion: number;
  sourceLimits: Partial<Record<ContextSourceKind, number>>;
  maxItems: number;
}
```

### Contract invariants

- IDs are stable within one run.
- Every selected item has provenance and a score explanation.
- DAG dependencies reference existing nodes and contain no cycle.
- Every planned node has at least one success criterion.
- High/critical nodes require explicit approval metadata.
- Persisted content never includes API keys or known secret patterns.

## 6. Dynamic Context Engine

### Pipeline

```text
Prompt
  -> Query analysis
  -> Source adapters
  -> Candidate normalization
  -> Secret/path filtering
  -> Exact and near dedupe
  -> Ranking
  -> Budget allocation
  -> Selection and excerpting
  -> Frozen turn snapshot
  -> Context injection
  -> Trace event
```

### V1 sources

#### Conversation

Use recent user/assistant messages and explicit pinned facts. Do not duplicate the full conversation already supplied by Pi. This adapter extracts references, unresolved questions, file paths, symbols, and errors.

#### Code

Use file path matches, lexical search, imports, references, and nearby symbols. Prefer current repository tools and `rg`; use a correct `grep` fallback. Exclude `.git`, dependencies, generated output, caches, and binary files.

#### Git

Use current diff, recently modified files, recent commit subjects, and files changed together. Git is optional; absence of a repository is not an error.

#### Memory

Read `.pi/memory/MEMORY.md` and referenced memory topics. Memory has higher authority for explicit user preferences and project constraints, but lower authority for facts that code can prove.

#### Knowledge

Read `.pi/knowledge-base/index.json`. V1 reuses keyword chunks and does not require embeddings.

### Ranking

Normalize each positive component to `[0, 1]`:

```text
total =
  lexical * 0.30
  + symbol * 0.20
  + dependency * 0.15
  + recency * 0.10
  + attention * 0.10
  + authority * 0.15
  - tokenPenalty
```

Rules:

- exact file mentions receive a deterministic boost;
- current diff files receive a recency/attention boost;
- imports and direct references outrank directory proximity;
- pinned items bypass ranking but still consume budget;
- excluded paths never become candidates;
- score ties are resolved deterministically by URI.

### Budget

Default V1 budget:

```json
{
  "totalTokens": 24000,
  "reservedForConversation": 6000,
  "reservedForCompletion": 8000,
  "sourceLimits": {
    "code": 9000,
    "git": 2500,
    "memory": 2000,
    "knowledge": 3500,
    "conversation": 3000
  },
  "maxItems": 20
}
```

The effective budget is capped by current model context usage. If token usage is unknown, use conservative defaults.

### Injection

Use `before_agent_start` to create a frozen context snapshot for the turn. Return one hidden custom message containing selected context and a compact trace summary. Use the `context` hook only for defensive dedupe and compaction recovery; avoid rebuilding context before every provider request.

Injected format:

```xml
<dynamic_context run_id="...">
  <item id="..." source="code" uri="src/login.ts" score="0.92">
    ...
  </item>
</dynamic_context>
```

The model receives selection reasons only in compact form. Full traces are stored on disk.

## 7. Skill Registry

The registry is generated dynamically and is not a second handwritten tool list.

### Inputs

- `pi.getAllTools()` for tool metadata and source information;
- `pi.getActiveTools()` for active state;
- `pi.getCommands()` for extension, prompt, and skill commands;
- `before_agent_start.systemPromptOptions.skills` for loaded skill metadata.

### Normalization

Map each capability to `CapabilityDescriptor`. Tags and risk are derived using deterministic rules:

- `read`, search, list: low risk;
- network access: medium risk;
- file write/edit: high risk;
- shell, git commit, delete, deploy: high or critical depending on arguments;
- unknown extension capabilities default to medium risk.

Registry APIs:

- `listCapabilities(filter)`
- `getCapability(id)`
- `matchCapabilities(taskText)`
- `getAllowedCapabilities(policy)`

V1 does not automatically disable tools globally. The planner recommends a minimal set. Execution-time enforcement remains with Security Gate and existing tool activation controls.

## 8. Dynamic Planner

### Direct versus planned mode

Skip planning when all conditions hold:

- one clear action;
- no external research;
- low risk;
- at most two likely capabilities;
- no cross-file or multi-step dependency.

Use planned mode for ambiguous, multi-source, multi-file, high-risk, research, or parallelizable tasks.

### Planner input

```typescript
export interface PlannerInput {
  prompt: string;
  selectedContext: SelectedContext[];
  capabilities: CapabilityDescriptor[];
  budget: ContextBudget;
  policy: PlannerPolicy;
}
```

### Planner output

The LLM returns `TaskPlan` JSON. Validate it with TypeBox, then apply deterministic checks:

- unique IDs;
- valid dependency references;
- acyclic graph;
- known capability IDs;
- non-empty success criteria;
- node and depth limits;
- risk and approval consistency.

If validation fails twice, fall back to direct mode with a trace warning.

Default limits:

- maximum 8 nodes;
- maximum dependency depth 4;
- maximum 2 planning attempts;
- maximum 4 capabilities per node;
- no automatic plan execution in V1.

### Planner tool

`intelligence_plan` accepts an optional objective and returns the validated DAG. It does not mutate files or launch agents.

### Planner system integration

For complex tasks, `before_agent_start` injects the plan as a hidden message and instructs the main agent to execute ready nodes in dependency order. The user can inspect the plan through `/intelligence plan`.

## 9. Persistence and Observability

```text
.pi/intelligence/
  config.json
  pins.json
  exclusions.json
  runs/
    <run-id>/
      manifest.json
      events.jsonl
      candidates.jsonl
      selected-context.json
      plan.json
```

### Event types

- `run.started`
- `context.candidate`
- `context.rejected`
- `context.selected`
- `context.injected`
- `registry.snapshot`
- `plan.requested`
- `plan.validated`
- `plan.fallback`
- `run.completed`
- `run.failed`

Every event includes `version`, `runId`, `timestamp`, `event`, and structured data. Secret values are redacted before persistence.

## 10. Security and Permissions

- Respect `.gitignore` and `.pi/intelligence/exclusions.json`.
- Exclude `.env`, credentials, SSH keys, auth stores, browser profiles, and known secret filenames by default.
- Redact API-key-like patterns before model injection and disk traces.
- Source adapters are read-only in V1.
- Planning cannot override Security Gate.
- Context from webpages or documents is untrusted data, never system instructions.
- Capability activation is advisory in V1; destructive execution still requires approval.

## 11. Commands and Tools

### Commands

- `/intelligence status`: current mode, budget, selected items, and plan summary.
- `/intelligence trace`: open or print the latest decision trace.
- `/context`: inspect selected, pinned, and excluded context.

### Tools

- `context_status`: selected items, scores, and token usage.
- `context_pin`: pin a file, memory item, or URI.
- `context_exclude`: exclude a path or URI pattern.
- `intelligence_plan`: generate and validate a task DAG.
- `skill_registry`: list and match capabilities.

## 12. Implementation Phases

### Phase 0: Contract and harness

- Create contracts and TypeBox schemas.
- Add DAG validator and token estimator.
- Add in-memory fake Pi API test harness.
- Add JSONL event ledger.

Exit criteria: contracts round-trip through JSON and invalid DAGs are rejected.

### Phase 1: Skill Registry

- Normalize tools, commands, and skills.
- Add risk classification and matching.
- Add registry snapshot trace.

Exit criteria: registry reflects actual loaded capabilities without a handwritten inventory.

### Phase 2: Context Engine

- Implement conversation, code, Git, memory, and knowledge adapters.
- Add filtering, dedupe, ranking, budget, pin/exclude.
- Add frozen snapshot injection.

Exit criteria: a code task selects expected files within budget and records reasons.

### Phase 3: Planner

- Add direct/planned classifier.
- Add structured planner prompt and TypeBox validation.
- Add DAG validation, fallback, and plan trace.

Exit criteria: complex tasks produce valid DAGs; simple tasks skip planning.

### Phase 4: Integration and hardening

- Add commands and status tools.
- Add secret redaction, cancellation, and bounded I/O.
- Run interactive, print, and RPC smoke tests.
- Deploy only after full project checks pass.

## 13. Test Matrix

### Unit tests

- stable hashing and IDs;
- exact and near dedupe;
- score calculation and deterministic ties;
- token budget and source quotas;
- pin/exclude precedence;
- secret redaction;
- registry normalization and risk mapping;
- DAG cycle detection and dependency validation;
- direct/planned classification;
- JSONL event serialization.

### Integration tests

Use fake provider and temporary repositories:

1. User names a file: exact file ranks first.
2. User names a symbol: defining and importing files rank above README.
3. Dirty Git diff: changed files receive a boost.
4. No Git repository: context collection continues.
5. Memory preference: explicit preference is selected.
6. Secret file: candidate is rejected and never persisted.
7. Budget pressure: lower-ranked items are excerpted or removed.
8. Simple task: planner returns direct mode.
9. Complex research task: planner returns a valid DAG.
10. Invalid planner output: retry then deterministic fallback.
11. Extension reload: no duplicate injection.
12. Compaction: latest frozen snapshot can be restored.

### Manual smoke tests

- interactive TUI: inspect `/context` and `/intelligence status`;
- print mode: one-shot plan and context trace;
- RPC mode: no UI dependency;
- 200k context model and smaller context model;
- project with 10k+ files;
- project containing generated files and secrets.

## 14. Acceptance Criteria

V1 is complete only when:

- `npm run check` passes with no warnings or infos requiring action;
- all new test files pass independently;
- context selection never exceeds its effective token budget;
- every injected item has provenance and a traceable score;
- exact user file references rank in the top three unless excluded;
- secret fixtures never reach model context or trace files;
- simple tasks avoid planner overhead;
- complex task plans are valid acyclic DAGs;
- invalid model output falls back safely;
- no source adapter writes to project files;
- disabling the extension restores normal Pi behavior.

## 15. V2 Extension Points

V1 contracts deliberately support later modules:

- evaluator attaches scores to plan nodes;
- reflection creates a new plan version rather than mutating history;
- dynamic sub-agents consume `PlanNode` and minimal selected context;
- memory manager stores only validated outcomes and explicit preferences;
- workflow engine executes ready DAG nodes with concurrency and write ownership;
- evolution analyzes aggregate run manifests after enough evidence exists.

V2 should start only after V1 demonstrates measurable gains on real coding tasks: fewer irrelevant context tokens, fewer redundant tool calls, and no material increase in failure rate.
