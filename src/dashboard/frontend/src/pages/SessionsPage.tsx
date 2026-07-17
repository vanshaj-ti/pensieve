import { useEffect, useState } from 'react';
import { fetchSessionProjects, fetchSessionsAll } from '../api';
import type { DiskSession, SessionProject } from '../types';
import { useAnalyzeJob } from '../hooks/useAnalyzeJob';
import type { Route } from '../hooks/useRoute';
import { RouteLink } from '../components/RouteLink';

interface Props {
  onNavigate: (route: Route) => void;
}

const PAGE_SIZE = 20;

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

function ProjectList({ onSelect }: { onSelect: (projectDir: string) => void }) {
  const [projects, setProjects] = useState<SessionProject[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSessionProjects()
      .then(setProjects)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load projects'));
  }, []);

  if (error) {
    return <div className="error-banner">Failed to load projects: {error}</div>;
  }

  if (!projects) {
    return null;
  }

  if (projects.length === 0) {
    return (
      <div className="empty-state" style={{ gridColumn: '1 / -1' }}>
        No Claude Code sessions found under ~/.claude/projects/.
      </div>
    );
  }

  return (
    <main>
      <section className="card span-full">
        <h2>Projects</h2>
        <ul className="insight-list">
          {projects.map((p) => (
            <li className="insight-item" key={p.projectDir}>
              <button
                className="label-edit-btn"
                style={{ fontSize: '0.9rem', textAlign: 'left' }}
                onClick={() => onSelect(p.projectDir)}
              >
                {p.cwd || p.projectDir}
              </button>
              <div className="insight-meta">
                <span>{p.sessionCount} sessions</span>
                <span>{p.analyzedCount} analyzed</span>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function ProjectSessions({
  projectDir,
  onBack,
  onNavigate,
}: {
  projectDir: string;
  onBack: () => void;
  onNavigate: (route: Route) => void;
}) {
  const [page, setPage] = useState(1);
  const [sessions, setSessions] = useState<DiskSession[] | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    fetchSessionsAll(projectDir, page, PAGE_SIZE)
      .then((res) => {
        setSessions(res.sessions);
        setTotalPages(res.totalPages);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load sessions'));
  };

  useEffect(load, [projectDir, page]);

  const { jobs, start } = useAnalyzeJob(load);

  return (
    <main>
      <section className="card span-full">
        <h2>
          <button className="label-edit-btn" onClick={onBack}>
            ← Projects
          </button>
          <span className="card-hint">{projectDir}</span>
        </h2>

        {error && <div className="error-banner">Failed to load sessions: {error}</div>}

        {sessions && sessions.length === 0 && (
          <div className="empty-state">No sessions found for this project.</div>
        )}

        {sessions && sessions.length > 0 && (
          <ul className="insight-list">
            {sessions.map((s) => {
              const key = `${s.projectDir}/${s.sessionId}`;
              const job = jobs[key];
              const analyzing = job && job.status !== 'done' && job.status !== 'failed';

              return (
                <li className="insight-item" key={s.sessionId}>
                  <div className="badge-row">
                    {s.title ? (
                      <>
                        <span className="insight-text">{s.title}</span>
                        <span className="insight-meta" style={{ fontFamily: 'monospace' }}>
                          {s.sessionId}
                        </span>
                      </>
                    ) : (
                      <span className="insight-text" style={{ fontFamily: 'monospace' }}>
                        {s.sessionId}
                      </span>
                    )}
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
        )}

        {totalPages > 1 && (
          <div className="badge-row" style={{ justifyContent: 'center', gap: 12, marginTop: 16 }}>
            <button
              className="label-edit-btn"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              ← Prev
            </button>
            <span className="insight-meta">
              Page {page} of {totalPages}
            </span>
            <button
              className="label-edit-btn"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next →
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

export function SessionsPage({ onNavigate }: Props) {
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

  if (selectedProject) {
    return (
      <ProjectSessions
        projectDir={selectedProject}
        onBack={() => setSelectedProject(null)}
        onNavigate={onNavigate}
      />
    );
  }

  return <ProjectList onSelect={setSelectedProject} />;
}
