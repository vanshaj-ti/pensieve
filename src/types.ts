import { z } from 'zod';

/**
 * What kind of work-phase a work item belongs to. Not a hierarchy of
 * insight-worthiness — every category can hold trivial or critical items;
 * significanceScore and the Insight/derived-insight promotion decide that.
 * - architecture_decisions: an architecture/product choice + stated reason
 *   (absorbs the old strategic_value — a strategic call without a decision
 *   attached is rare and usually just an unripe high_potential_seeds).
 * - exploration: research/investigation of an approach, whether or not it
 *   led anywhere — the "considered X, spent real effort weighing it"
 *   bucket, distinct from decision_record (which requires a conclusion).
 * - mechanical_labor: implementation, testing, routine/known execution —
 *   no new judgment required. Includes strong AI-assisted implementation
 *   work (no separate ai_leverage category) and routine status/progress
 *   narration ("tests passing", "build clean") that used to be hard-
 *   excluded from extraction entirely — now tagged here instead, so the
 *   toil/overhead accounting isn't blind to it.
 * - bug_fix: root cause diagnosed + resolution applied. Distinct from
 *   friction_audit, which is the problem/symptom itself, not the fix.
 * - ai_correction_load: the user caught or fixed an AI mistake.
 * - friction_audit: a blocker, error, or time-wasting obstacle that is
 *   NOT a code bug — slow CI, a confusing tool error, a process
 *   breakdown. The symptom, not the resolution (see bug_fix).
 * - high_potential_seeds: a future/speculative idea explicitly deferred,
 *   not yet acted on.
 */
export const InsightCategory = z.enum([
  'architecture_decisions',
  'exploration',
  'mechanical_labor',
  'bug_fix',
  'ai_correction_load',
  'friction_audit',
  'high_potential_seeds',
]);
export type InsightCategory = z.infer<typeof InsightCategory>;

/**
 * Orthogonal to category — answers "what kind of effort produced this,"
 * not "what kind of thing is this." Two friction_audit insights can be one
 * of each: a hard, non-repeatable bug (judgment) vs. the same manual
 * workaround applied twice because nobody fixed the root cause (toil).
 * - toil: mechanical/repetitive work that shouldn't have needed a human
 *   more than once (e.g. repeatedly re-running the same manual fix).
 * - judgment: real skilled reasoning or non-repeatable problem-solving.
 * - overhead: necessary but zero-signal cost (waiting, setup, tool
 *   friction) — neither toil nor judgment, just tax on the session.
 */
export const EffortClass = z.enum(['toil', 'judgment', 'overhead']);
export type EffortClass = z.infer<typeof EffortClass>;

export interface Session {
  projectDir: string;
  sessionId: string;
  lastLine: number;
  lastRunAt: string;
}

export interface Episode {
  id: number;
  date: string;
  projectDir: string;
  sessionId: string;
  startLine: number;
  endLine: number;
}

/** Haiku pass-1 output (spec §5 Pass 1) — high-recall, pre-verification. */
export const CandidateSchema = z.object({
  category: InsightCategory,
  text: z.string(),
  evidenceRef: z.string(),
  evidenceSnippet: z.string(),
});
export type Candidate = z.infer<typeof CandidateSchema>;

/** Sonnet pass-2 output (spec §5 Pass 2) — verified, deduped, scored. */
export const InsightSchema = z.object({
  id: z.number().optional(),
  episodeId: z.number(),
  category: InsightCategory,
  text: z.string(),
  evidenceRef: z.string(),
  significanceScore: z.number(),
  /** What kind of effort produced this insight — see EffortClass. Assigned
   * by Sonnet (pass 2); Haiku's candidates don't carry this field. Defaults
   * to 'judgment' for pre-existing rows (via DB migration) and old test
   * fixtures that were created before this field existed. */
  effortClass: EffortClass.default('judgment'),
  /** Reserved for Pass 3 (cut from v0, spec §5 Pass 3) — always null until built. */
  verifiedByGit: z.boolean().nullable(),
  /** Reserved for recurrence linkage — null in v0's prompt-stuffing approach (spec §6). */
  recurrenceOf: z.number().nullable(),
  createdAt: z.string(),
});
export type Insight = z.infer<typeof InsightSchema>;

/** OpenAI-compatible embeddings response. */
export const EmbeddingResponseSchema = z.object({
  data: z.array(z.object({ embedding: z.array(z.number()), index: z.number() })).min(1),
});
export type EmbeddingResponse = z.infer<typeof EmbeddingResponseSchema>;

/**
 * A derived insight is NOT a work item — it's a higher-level conclusion
 * computed from a session's full set of work items (Insight rows),
 * answering one of: what am I doing wrong (struggle), what am I doing
 * right (win), what am I learning (learning), what's worth exploring
 * (idea — distinct from a raw high_potential_seeds work item; this is
 * synthesis pulling the most worthwhile seed(s) forward), or what
 * unaddressed problem is building up (risk, e.g. a recurring toil
 * pattern or friction/bug cluster not yet fixed).
 */
export const DerivedInsightType = z.enum(['struggle', 'win', 'learning', 'idea', 'risk']);
export type DerivedInsightType = z.infer<typeof DerivedInsightType>;

/** Generated on-demand per session (not automatic per-day like the brief's narrative). */
export const DerivedInsightSchema = z.object({
  id: z.number().optional(),
  projectDir: z.string(),
  sessionId: z.string(),
  label: z.string(),
  insightType: DerivedInsightType,
  text: z.string(),
  /** Work-item (Insight) ids this conclusion is grounded in — its evidence trail. */
  evidenceInsightIds: z.array(z.number()),
  createdAt: z.string(),
});
export type DerivedInsight = z.infer<typeof DerivedInsightSchema>;
