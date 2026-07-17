# WaxPrep Phase 2 — Tutor That Actually Knows You

## Research applied

| Area | Source | Implementation |
|---|---|---|
| Bayesian Knowledge Tracing | Corbett & Anderson 1995 | `src/teaching/bkt.ts` — masteryLevel = P(learned) |
| Prerequisite / knowledge graphs | ITS curriculum sequencing | `src/teaching/lesson_graph.ts` |
| Hierarchical memory | MemGPT-style paging / consolidation | `src/memory/dossier.ts`, `hierarchical.ts` |
| Soft constraints vs hard rules | Hybrid agent design | Deliberation: policy is advisor; hard only for safety |
| Teaching quality metrics | AutoTutor / tutor evaluation | `src/observability/metrics.ts` |

## Philosophy (aligned with vision)

- **Trust the model** for most turns — soft policy advises, does not cage.
- **Hard enforce only** when students are at risk of interrogation loops: ready, don't-know, exit, overload, consecutive questions ≥ 2.
- **Remember** via ranked dossier + instant facts + BKT scalars, not raw chat dumps.
- **Teach something real** via lesson graph micro-chunks when foundation is weak.

## New modules

- `src/teaching/bkt.ts`
- `src/teaching/lesson_graph.ts` (biology/anatomy foundation path)
- `src/memory/dossier.ts`
- `src/memory/hierarchical.ts`
- `src/observability/metrics.ts`
- `scripts/simulate_phase2.ts`
- `CHANGELOG_phase2.md`

## Upgraded

- `src/memory/semantic.ts` — true BKT mastery updates
- `src/teaching/deliberation.ts` — soft advisor + hard safety
- `src/agents/crew.ts` — dossier + lesson packet in context; metrics
- `src/workers/memory_compressor.ts` — archive + recent consolidation

## Tests

```bash
npx tsc --noEmit
npx tsx scripts/simulate_policy.ts
npx tsx scripts/simulate_phase2.ts
```

## Remaining limitations

- Lesson graph is currently richest for biology/anatomy; other subjects need paths.
- BKT params are global defaults (not yet per-concept EM-fitted).
- Hierarchical consolidate still uses LLM summaries (cost on worker schedule).
- No multi-region infra rewrite in this phase (deliberately student-intelligence first).

## Next phases

1. Per-subject lesson graphs (physics, chemistry, maths, English)
2. Per-concept BKT parameter learning from production logs
3. DKT sequence model offline for hard concepts
4. Prompt evolution fitness = teach-rate / question-rate / retention
