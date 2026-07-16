import { z } from 'zod';

/** Mirrors the six telemetry categories from docs/product/03-telemetry-categories.md */
export const InsightCategory = z.enum([
  'strategic_value',
  'decision_record',
  'friction_audit',
  'high_potential_seeds',
  'ai_leverage',
  'ai_correction_load',
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
