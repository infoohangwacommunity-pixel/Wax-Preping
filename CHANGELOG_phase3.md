# WaxPrep Phase 3 — Curriculum Intelligence Engine

## Research completed

| Source | Finding |
|---|---|
| **NERDC e-Curriculum** (nerdc.org.ng) | Official Nigerian curriculum portal — **no public machine-readable API** (login/browse only) |
| **WAEC / NECO / JAMB** | Syllabi and brochures are PDF/human docs, not structured APIs |
| **questions.africa / similar** | Past-question APIs — useful for items, not full concept graphs |
| **Electric Sheep Africa HF datasets** | Synthetic subject-offering stats — not concept prerequisites |
| **ITS / BKT / DKT literature** | Prerequisite graphs + mastery sequencing + sequential tracing |

### Selected approach
**Versioned JSON curriculum packs** + Postgres store + graph navigator.

Why: no reliable free public Nigerian curriculum API exists for concept-level graphs. Packs are:
- Data, not code (unlimited subjects without deploys)
- Versioned and replaceable
- Attributable to sources (NERDC/WAEC/JAMB-aligned curation)
- Future-proof for scrapers/LLM extraction pipelines

## Architecture

```
curriculum/packs/*.json
        ↓ ingest
Postgres: curriculum_packs | subjects | concepts | edges | bkt_concept_params | knowledge_trace_events
        ↓
graph.navigateNext() → concept packet → deliberation context
```

## New modules

| Path | Role |
|---|---|
| `src/curriculum/schema.ts` | Domain types |
| `src/curriculum/store.ts` | Postgres persistence |
| `src/curriculum/ingest.ts` | Pack validation + import |
| `src/curriculum/graph.ts` | Prerequisite-aware navigation |
| `src/curriculum/engine.ts` | Facade + bootstrap |
| `src/curriculum/bkt_params.ts` | Per-concept BKT learning |
| `src/curriculum/dkt.ts` | Sequential DKT-style predictor |
| `curriculum/packs/*.json` | Biology + Mathematics foundation packs |

## Removed / replaced

- Hard-coded `BIOLOGY_FOUNDATION` lesson content in TypeScript
- Subject-name branching as the source of truth for curriculum

`lesson_graph.ts` is now a **thin bridge** that loads packs (file or DB).

## Student modeling upgrades

- BKT uses **per-concept parameters** when enough `knowledge_trace_events` exist
- Trace events logged on every mastery update
- DKT module: recency-weighted sequential predictions + action recommendation

## Evolution engine

Fitness now includes **teach-rate** and **question-rate** from `teaching_metrics`, not only engagement vanity scores.

## Tests

```bash
npx tsc --noEmit
npx tsx scripts/simulate_policy.ts
npx tsx scripts/simulate_phase2.ts
npx tsx scripts/simulate_phase3.ts
```

## Adding a new subject (no code change)

1. Create `curriculum/packs/ng_<subject>_....json` with meta/subjects/concepts/edges
2. Restart app (bootstrap ingests) or call `ingestPackDirectory()`
3. Tutor resolves subject via name/aliases

## Remaining limitations

- Packs are curated, not live-scraped from NERDC (no public API)
- Neural DKT weights not trained (architecture + sequential baseline shipped)
- Per-concept BKT refit is online-heuristic, not full EM
- Cross-subject transfer edges are minimal

## Next phases

1. NERDC/WAEC PDF → pack extraction worker
2. Offline DKT training job on `knowledge_trace_events`
3. EM-based BKT parameter estimation
4. Exam-weight signals from past-question topic frequencies
