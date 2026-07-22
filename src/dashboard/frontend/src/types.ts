export type InsightCategory =
  | 'architecture_decisions'
  | 'exploration'
  | 'mechanical_labor'
  | 'bug_fix'
  | 'ai_correction_load'
  | 'friction_audit'
  | 'high_potential_seeds';

export type EffortClass = 'toil' | 'judgment' | 'overhead';

export type DateRange = { date: string } | { fromDate: string; toDate: string };

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

export interface FlaggedDirective {
  humanLineNumber: number;
  reason: string;
  createdAt: string;
}

export interface EngagementBreakdown {
  directive: number;
  directiveNecessary: number;
  directiveUnnecessary: number;
  deliberative: number;
  corrective: number;
  acknowledgment: number;
  total: number;
  engagementRatio: number | null;
  longestDirectiveBurst: number;
  flaggedDirectives: FlaggedDirective[];
}

export interface EngagementBreakdownTrendPoint extends EngagementBreakdown {
  date: string;
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
  derivedInsightCount: number;
}

export type AnalyzeJobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface AnalyzeJob {
  status: AnalyzeJobStatus;
  insightsPersisted?: number;
  error?: string;
}

export interface BriefListResponse {
  dates: string[];
}

export interface BriefDetailResponse {
  date: string;
  content: string;
}

export interface PaginatedTopInsights {
  insights: TopInsight[];
  total: number;
  totalPages: number;
  limit: number;
  offset: number;
}

export interface SearchResult {
  type: 'project' | 'session' | 'insight';
  projectDir: string;
  sessionId?: string;
  label?: string;
  insightId?: number;
  text: string;
}
