import { useEffect, useState } from 'react';
import { fetchSessionRuns } from '../api';
import type { SessionRun } from '../types';
import { useAnalyzeJob } from '../hooks/useAnalyzeJob';
import type { Route } from '../hooks/useRoute';
import { RouteLink } from '../components/RouteLink';

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

  const load = () => {
    fetchSessionRuns(projectDir, sessionId)
      .then(setRuns)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load runs'));
  };

  useEffect(load, [projectDir, sessionId]);

  const jobKey = `${projectDir}/${sessionId}`;
  const { jobs, start } = useAnalyzeJob(load);
  const job = jobs[jobKey];
  const analyzing = job && job.status !== 'done' && job.status !== 'failed';

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
            className="label-edit-btn"
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
            {runs.map((run) => (
              <li className="insight-item" key={run.label}>
                <div className="badge-row">
                  <span className="badge badge-category">{run.label || '(default)'}</span>
                  <span className="badge badge-score">{run.insightCount} insights</span>
                </div>
                <div className="insight-meta">
                  <span>{relativeTime(run.latestAt)}</span>
                  <RouteLink
                    className="label-edit-btn"
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
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
