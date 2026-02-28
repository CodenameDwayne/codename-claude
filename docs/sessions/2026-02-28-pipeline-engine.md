# Pipeline Engine Implementation Session — 2026-02-28

## What We Built

Replaced Agent Teams as the default orchestration with a daemon-orchestrated pipeline engine. The system uses an LLM router (Haiku) to pick agents and runs them sequentially with a review loop.

### New Files
- `src/pipeline/router.ts` — Agent summary loader + LLM router (Haiku API call to select pipeline stages)
- `src/pipeline/engine.ts` — Sequential pipeline executor with APPROVE/REVISE/REDESIGN review loop
- `src/pipeline/router.test.ts` — 4 tests
- `src/pipeline/engine.test.ts` — 5 tests
- `src/pipeline/integration.test.ts` — 2 tests (router + engine end-to-end)

### Modified Files
- `src/heartbeat/loop.ts` — `runAgent` → `runPipeline` (returns `PipelineResult` with `stagesRun`)
- `src/daemon.ts` — Wired `PipelineEngine` + `routeTask`, created `runPipeline` function
- `src/cli.ts` — Added `run pipeline` command, updated `run team` to use pipeline
- `src/agents/runner.ts` — Removed `readTeammateDefinitions` and teammate context injection
- `src/heartbeat/loop.test.ts` — Updated to use `runPipeline` interface
- `src/integration.test.ts` — Updated from `RunResult` to `PipelineResult`

### New Dependency
- `@anthropic-ai/sdk` — Used by the router's `createDefaultClient` for Haiku API calls

## Execution Stats

- **10 tasks** across **4 batches**, executed via TDD (red → green → commit)
- **9 commits** on `feature/pipeline-engine`
- **111 total tests** (up from 100), 14 test files, all passing
- **Clean `tsc` build** throughout

## Things That Went Well

1. **TDD flow was smooth.** Every task started with a failing test, then implementation, then green. No debugging loops needed — every implementation passed on the first run.

2. **Plan was high quality.** The plan's code snippets were directly usable with only minor adaptations. Having exact file paths, test code, and implementation code meant minimal guessing.

3. **Worktree isolation worked perfectly.** Branching from `main` into `.worktrees/pipeline-engine` gave a clean baseline. The unstaged changes on `main` (delegation hooks in daemon.ts, delegate-mode prompt in runner.ts) didn't contaminate the feature branch, which actually simplified Tasks 8-9.

4. **Dependency injection pattern for the Anthropic API.** The `CreateMessageFn` type let tests inject mocks without `vi.mock()` — cleaner and more reliable with ESM modules.

5. **Integration test updates went cleanly.** Updating `src/integration.test.ts` from `RunResult`/`runAgent` to `PipelineResult`/`runPipeline` required rethinking the mock signatures but the test logic mapped naturally.

## Things That Required Adaptation

1. **`@anthropic-ai/sdk` was not installed.** The plan assumed it was available, but `package.json` only had `@anthropic-ai/claude-agent-sdk`. Fixed by running `bun add @anthropic-ai/sdk` before Task 1.

2. **Anthropic SDK type mismatch in `createDefaultClient`.** The SDK's `messages.create` returns `APIPromise<Stream | Message>` which doesn't match the simplified `CreateMessageFn` type. The plan's simple cast (`params as Parameters<...>`) failed at build time. Fixed by writing an explicit async wrapper that maps the response to our simplified type.

3. **`readTextFile` not available in daemon.ts.** The plan referenced it but it's a private function in `runner.ts`. Added a local `readTextFileSafe` helper in the daemon.

4. **`npm` → `bun`.** Plan used `npm run build` but the project had switched to bun. Minor — just used `bun run build` instead.

5. **Task 8 was a no-op.** The delegation hooks (`createPreToolUseDenyHook`, `createUserPromptSubmitHook`) were unstaged changes on `main`, not committed. The worktree branched from the committed HEAD, so they never existed in the feature branch. No removal needed.

6. **Runner.ts worktree state differed from plan's assumptions.** The plan expected a `[DELEGATE MODE ACTIVE]` prompt injection at lines 294-297, but the worktree's committed version didn't have it (it was a staged change on main). The teammate definitions and context injection *did* exist and were removed as planned.

## Architecture Decisions

- **Engine owns its own types** (`RunnerResult`, `RunnerOptions`) rather than importing from `runner.ts`. This decouples the pipeline module from the agent runner's internal types.
- **`agent: 'pipeline'` sentinel value** in the IPC protocol triggers the full LLM routing path. Any other agent name bypasses the router for backwards compatibility.
- **Review loop is a while-loop state machine** — the index `i` jumps backwards based on reviewer verdict. `maxRetries` (default 3) prevents infinite loops.
- **Prompt estimation** changed from `mode === 'team' ? 50 : 10` to `result.stagesRun * 10` — more accurate since each pipeline stage is roughly one agent session.

## What's Next

- Wire up real agent definitions in `~/.codename-claude/agents/` and test with a live Haiku router call
- Add observability — pipeline stage timings, review scores over time
- Consider persisting pipeline run history to `.brain/PIPELINE_LOG.md`
