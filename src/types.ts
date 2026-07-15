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
  /** Reserved for Pass 3 (cut from v0, spec §5 Pass 3) — always null until built. */
  verifiedByGit: z.boolean().nullable(),
  /** Reserved for recurrence linkage — null in v0's prompt-stuffing approach (spec §6). */
  recurrenceOf: z.number().nullable(),
  createdAt: z.string(),
});
export type Insight = z.infer<typeof InsightSchema>;
