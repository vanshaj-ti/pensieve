import { useEffect, useState } from 'react';
import { fetchSessionsAll } from '../api';
import type { DiskSession } from '../types';
import { useAnalyzeJob } from '../hooks/useAnalyzeJob';
import type { Route } from '../hooks/useRoute';
import { RouteLink } from '../components/RouteLink';

interface Props {
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

export function SessionsPage({ onNavigate }: Props) {
  const [sessions, setSessions] = useState<DiskSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    fetchSessionsAll()
      .then(setSessions)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load sessions'));
  };

  useEffect(load, []);

  const { jobs, start } = useAnalyzeJob(load);

  if (error) {
    return <div className="error-banner">Failed to load sessions: {error}</div>;
  }

  if (!sessions) {
    return null;
  }

  const byProject = new Map<string, DiskSession[]>();
  for (const s of sessions) {
    if (!byProject.has(s.projectDir)) byProject.set(s.projectDir, []);
    byProject.get(s.projectDir)!.push(s);
  }

  if (sessions.length === 0) {
    return (
      <div className="empty-state" style={{ gridColumn: '1 / -1' }}>
        No Claude Code sessions found under ~/.claude/projects/.
      </div>
    );
  }

  return (
    <main>
      {Array.from(byProject.entries()).map(([projectDir, projSessions]) => (
        <section className="card span-full" key={projectDir}>
          <h2>{projectDir}</h2>
          <ul className="insight-list">
            {projSessions.map((s) => {
              const key = `${s.projectDir}/${s.sessionId}`;
              const job = jobs[key];
              const analyzing = job && job.status !== 'done' && job.status !== 'failed';

              return (
                <li className="insight-item" key={s.sessionId}>
                  <div className="badge-row">
                    <span className="insight-text" style={{ fontFamily: 'monospace' }}>
                      {s.sessionId}
                    </span>
                  </div>
                  <div className="insight-meta">
                    <span>{relativeTime(s.mtime)}</span>
                    {analyzing ? (
                      <span className="badge badge-effort judgment">
                        {job.status === 'queued' ? 'Queued…' : 'Analyzing…'}
                      </span>
                    ) : s.analyzed ? (
                      <span className="badge badge-effort judgment">Analyzed ({s.runCount})</span>
                    ) : (
                      <span className="badge badge-score">Not analyzed</span>
                    )}
                    {job?.status === 'failed' && (
                      <span className="badge badge-effort toil" title={job.error}>
                        Failed
                      </span>
                    )}
                    <button
                      className="label-edit-btn"
                      disabled={!!analyzing}
                      onClick={() => start(key, s.projectDir, s.sessionId)}
                    >
                      Analyze
                    </button>
                    {s.analyzed && (
                      <RouteLink
                        className="label-edit-btn"
                        onNavigate={onNavigate}
                        to={{
                          kind: 'session-detail',
                          projectDir: s.projectDir,
                          sessionId: s.sessionId,
                        }}
                      >
                        View
                      </RouteLink>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </main>
  );
}
