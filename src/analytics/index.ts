import { CategoryTrendPoint } from './categoryTrend.js';
import { TopInsight } from './topInsights.js';
import { RecurrenceChain } from './recurrenceChains.js';
import { ProjectRollup } from './crossProjectRollup.js';
import { EffortBreakdown } from './effortBreakdown.js';
import { EngagementBreakdown } from './engagement.js';

export interface AnalyticsSnapshot {
  categoryTrend: CategoryTrendPoint[];
  topInsights: TopInsight[];
  recurrenceChains: RecurrenceChain[];
  crossProjectRollup: ProjectRollup[];
  effortBreakdown: EffortBreakdown;
  engagementBreakdown: EngagementBreakdown;
}

export * from './shared.js';
export * from './categoryTrend.js';
export * from './topInsights.js';
export * from './recurrenceChains.js';
export * from './effortBreakdown.js';
export * from './crossProjectRollup.js';
export * from './insightDates.js';
export * from './labels.js';
export * from './effortByCategory.js';
export * from './derivedInsights.js';
export * from './search.js';
export * from './engagement.js';
