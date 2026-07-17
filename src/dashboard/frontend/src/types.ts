export type InsightCategory =
  | 'architecture_decisions'
  | 'exploration'
  | 'mechanical_labor'
  | 'bug_fix'
  | 'ai_correction_load'
  | 'friction_audit'
  | 'high_potential_seeds';

export type EffortClass = 'toil' | 'judgment' | 'overhead';

export type DerivedInsightType = 'struggle' | 'win' | 'learning' | 'idea' | 'risk';

export interface DerivedInsight {
  id?: number;
  projectDir: string;
  sessionId: string;
  label: string;
  insightType: DerivedInsightType;
  text: string;
  evidenceInsightIds: number[];
  createdAt: string;
}

export interface Insight {
  id?: number;
  episodeId: number;
  category: InsightCategory;
  text: string;
  evidenceRef: string;
  significanceScore: number;
  effortClass: EffortClass;
  verifiedByGit: boolean | null;
  recurrenceOf: number | null;
  createdAt: string;
}

export interface TopInsight extends Insight {
  projectDir: string;
  sessionId: string;
  label: string;
}

export interface CategoryTrendPoint {
  date: string;
  category: string;
  count: number;
}

export interface EffortBreakdown {
  toil: number;
  judgment: number;
  overhead: number;
  total: number;
  toilRatio: number;
  judgmentRatio: number;
  overheadRatio: number;
}

export interface EffortBreakdownTrendPoint extends EffortBreakdown {
  date: string;
}

export interface EffortByCategoryPoint {
  category: string;
  toil: number;
  judgment: number;
  overhead: number;
  total: number;
}

export interface RecurrenceChain {
  rootId: number;
  insights: Insight[];
  span: { firstDate: string; lastDate: string };
}

export interface ProjectRollup {
  projectDir: string;
  insightCount: number;
}

export interface LabelSummary {
  label: string;
  count: number;
}

export interface ProjectSummary {
  projectDir: string;
  count: number;
}

export interface SessionSummary {
  projectDir: string;
  sessionId: string;
  count: number;
}

export interface AnalyticsFilter {
  label?: string;
  projectDir?: string;
  sessionId?: string;
}

export interface DiskSession {
  projectDir: string;
  sessionId: string;
  cwd: string | null;
  title: string | null;
  mtime: string;
  analyzed: boolean;
  runCount: number;
}

export interface PaginatedSessions {
  sessions: DiskSession[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface SessionProject {
  projectDir: string;
  cwd: string | null;
  sessionCount: number;
  analyzedCount: number;
}

export interface SessionRun {
  label: string;
  insightCount: number;
  latestAt: string;
}

export type AnalyzeJobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface AnalyzeJob {
  status: AnalyzeJobStatus;
  insightsPersisted?: number;
  error?: string;
}
