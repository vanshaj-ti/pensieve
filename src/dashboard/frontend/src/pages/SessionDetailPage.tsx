import { useEffect, useState } from 'react';
import { fetchDerivedInsights, fetchSessionRuns } from '../api';
import type { DerivedInsight, SessionRun } from '../types';
import { useAnalyzeJob } from '../hooks/useAnalyzeJob';
import { useDeriveInsightsJob } from '../hooks/useDeriveInsightsJob';
import type { Route } from '../hooks/useRoute';
import { RouteLink } from '../components/RouteLink';
import { DerivedInsights } from '../components/DerivedInsights';

interface Props {
  projectDir: string;
  sessionId: string;
  onNavigate: (route: Route) => void;
}

function relativeTime(iso: string): string {
  if (!iso) return '—';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function SessionDetailPage({ projectDir, sessionId, onNavigate }: Props) {
  const [runs, setRuns] = useState<SessionRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedLabel, setExpandedLabel] = useState<string | null>(null);
  const [derivedByLabel, setDerivedByLabel] = useState<Record<string, DerivedInsight[]>>({});

  const load = () => {
    fetchSessionRuns(projectDir, sessionId)
      .then(setRuns)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load runs'));
  };

  useEffect(load, [projectDir, sessionId]);

  const jobKey = `${projectDir}/${sessionId}`;
  const { jobs, start } = useAnalyzeJob(() => {
    load();
    // Re-fetch after short delay to capture auto-triggered derive-insights (eventually-consistent)
    setTimeout(load, 3000);
  });
  const job = jobs[jobKey];
  const analyzing = job && job.status !== 'done' && job.status !== 'failed';

  const loadDerivedFor = (label: string) => {
    fetchDerivedInsights(projectDir, sessionId, label)
      .then((insights) => setDerivedByLabel((prev) => ({ ...prev, [label]: insights })))
      .catch(console.error);
  };

  const { job: deriveJob, start: startDerive } = useDeriveInsightsJob(() => {
    if (expandedLabel) loadDerivedFor(expandedLabel);
  });
  const deriving = deriveJob && deriveJob.status !== 'done' && deriveJob.status !== 'failed';

  const toggleExpanded = (label: string) => {
    if (expandedLabel === label) {
      setExpandedLabel(null);
      return;
    }
    setExpandedLabel(label);
    if (!derivedByLabel[label]) loadDerivedFor(label);
  };

  if (error) {
    return <div className="error-banner">Failed to load session: {error}</div>;
  }

  if (!runs) {
    return null;
  }

  return (
    <main>
      <section className="card span-full">
        <h2>
          {projectDir} <span className="card-hint">{sessionId}</span>
        </h2>
        <div className="badge-row" style={{ marginBottom: 16 }}>
          <button
            className="btn btn-primary"
            disabled={!!analyzing}
            onClick={() => start(jobKey, projectDir, sessionId)}
          >
            {analyzing ? (job.status === 'queued' ? 'Queued…' : 'Analyzing…') : 'Run new analysis'}
          </button>
          {job?.status === 'failed' && (
            <span className="badge badge-effort toil" title={job.error}>
              Failed
            </span>
          )}
        </div>

        {runs.length === 0 ? (
          <div className="empty-state">No analysis runs yet for this session.</div>
        ) : (
          <ul className="insight-list">
            {runs.map((run) => {
              const isExpanded = expandedLabel === run.label;
              const derivingThis = isExpanded && deriving;

              return (
                <li key={run.label}>
                  <div className="session-row">
                    <div className="session-row-main">
                      <div className="badge-row">
                        <span className="badge badge-category">{run.label || '(default)'}</span>
                        <span className="badge badge-score">{run.insightCount} insights</span>
                        <span className="badge badge-score">
                          {run.derivedInsightCount > 0
                            ? `${run.derivedInsightCount} derived`
                            : 'No derived insights'}
                        </span>
                      </div>
                      <span className="insight-meta">{relativeTime(run.latestAt)}</span>
                    </div>
                    <div className="session-row-actions">
                      <button className="btn" onClick={() => toggleExpanded(run.label)}>
                        {isExpanded ? 'Hide Insights' : 'Derived Insights'}
                      </button>
                      <RouteLink
                        className="btn btn-primary"
                        onNavigate={onNavigate}
                        to={{
                          kind: 'session-run',
                          projectDir,
                          sessionId,
                          label: run.label,
                        }}
                      >
                        View
                      </RouteLink>
                    </div>
                  </div>
                  {isExpanded && (
                    <div style={{ padding: '0 4px 16px' }}>
                      <div className="badge-row" style={{ marginBottom: 12 }}>
                        <button
                          className="btn btn-primary"
                          disabled={!!derivingThis}
                          onClick={() => startDerive(projectDir, sessionId, run.label)}
                        >
                          {derivingThis
                            ? deriveJob?.status === 'queued'
                              ? 'Queued…'
                              : 'Deriving…'
                            : 'Derive Insights'}
                        </button>
                        {derivingThis && deriveJob?.status === 'failed' && (
                          <span className="badge badge-effort toil" title={deriveJob.error}>
                            Failed
                          </span>
                        )}
                      </div>
                      <DerivedInsights insights={derivedByLabel[run.label] ?? []} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
