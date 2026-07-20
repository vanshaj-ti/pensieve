import { useEffect, useState } from 'react';
import { fetchSessionProjects, fetchSessionsAll } from '../api';
import type { DiskSession, SessionProject } from '../types';
import { useAnalyzeJob } from '../hooks/useAnalyzeJob';
import type { Route } from '../hooks/useRoute';
import { RouteLink } from '../components/RouteLink';

interface Props {
  onNavigate: (route: Route) => void;
  initialProjectDir?: string;
}

const PAGE_SIZE = 20;

type SortBy = 'mtime' | 'title' | 'analyzed';
type SortDir = 'asc' | 'desc';
type AnalyzedFilter = '' | 'true' | 'false';

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
    return (
      <div className="loading-state" style={{ gridColumn: '1 / -1' }}>
        Loading…
      </div>
    );
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
            <li className="session-row" key={p.projectDir}>
              <div className="session-row-main">
                <button
                  className="label-edit-btn"
                  style={{ fontSize: '0.9rem', textAlign: 'left' }}
                  onClick={() => onSelect(p.projectDir)}
                >
                  {p.cwd || p.projectDir}
                </button>
              </div>
              <div className="session-row-actions insight-meta">
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
  const [sortBy, setSortBy] = useState<SortBy>('mtime');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [analyzedFilter, setAnalyzedFilter] = useState<AnalyzedFilter>('');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [sessions, setSessions] = useState<DiskSession[] | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Debounce search input so it doesn't fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Any filter/sort/search change resets to page 1.
  useEffect(() => {
    setPage(1);
  }, [sortBy, sortDir, analyzedFilter, debouncedQuery, projectDir]);

  const load = () => {
    fetchSessionsAll(projectDir, {
      page,
      pageSize: PAGE_SIZE,
      sortBy,
      sortDir,
      analyzed: analyzedFilter || undefined,
      q: debouncedQuery || undefined,
    })
      .then((res) => {
        setSessions(res.sessions);
        setTotalPages(res.totalPages);
        setTotal(res.total);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load sessions'));
  };

  useEffect(load, [projectDir, page, sortBy, sortDir, analyzedFilter, debouncedQuery]);

  const { jobs, start } = useAnalyzeJob(load);

  const toggleSort = (key: SortBy) => {
    if (sortBy === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortDir(key === 'title' ? 'asc' : 'desc');
    }
  };

  const sortIndicator = (key: SortBy) => (sortBy === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '');

  return (
    <main>
      <section className="card span-full">
        <h2>
          <button className="label-edit-btn" onClick={onBack}>
            ← Projects
          </button>
          <span className="card-hint">{projectDir}</span>
        </h2>

        <div className="sort-controls">
          <button
            className={sortBy === 'mtime' ? 'active' : ''}
            onClick={() => toggleSort('mtime')}
          >
            Sort by date{sortIndicator('mtime')}
          </button>
          <button
            className={sortBy === 'title' ? 'active' : ''}
            onClick={() => toggleSort('title')}
          >
            Sort by title{sortIndicator('title')}
          </button>
          <button
            className={sortBy === 'analyzed' ? 'active' : ''}
            onClick={() => toggleSort('analyzed')}
          >
            Sort by status{sortIndicator('analyzed')}
          </button>
          <select
            className="search-box"
            style={{ width: 150 }}
            value={analyzedFilter}
            onChange={(e) => setAnalyzedFilter(e.target.value as AnalyzedFilter)}
          >
            <option value="">All sessions</option>
            <option value="true">Analyzed only</option>
            <option value="false">Not analyzed only</option>
          </select>
          <input
            type="search"
            className="search-box"
            placeholder="Search title or session id…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {error && <div className="error-banner">Failed to load sessions: {error}</div>}

        {sessions === null && <div className="loading-state">Loading…</div>}

        {sessions && sessions.length === 0 && (
          <div className="empty-state">
            {query || analyzedFilter
              ? 'No sessions match the current search/filter.'
              : 'No sessions found for this project.'}
          </div>
        )}

        {sessions && sessions.length > 0 && (
          <ul className="insight-list">
            {sessions.map((s) => {
              const key = `${s.projectDir}/${s.sessionId}`;
              const job = jobs[key];
              const analyzing = job && job.status !== 'done' && job.status !== 'failed';

              return (
                <li className="session-row" key={s.sessionId}>
                  <div className="session-row-main">
                    {s.title && <span className="session-row-title">{s.title}</span>}
                    <span className="session-row-id">{s.sessionId}</span>
                    <span className="insight-meta">{relativeTime(s.mtime)}</span>
                  </div>
                  <div className="session-row-actions">
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
                      className="btn"
                      disabled={!!analyzing}
                      onClick={() => start(key, s.projectDir, s.sessionId)}
                    >
                      Analyze
                    </button>
                    {s.analyzed && (
                      <>
                        <RouteLink
                          className="btn"
                          onNavigate={onNavigate}
                          to={{
                            kind: 'session-detail',
                            projectDir: s.projectDir,
                            sessionId: s.sessionId,
                          }}
                        >
                          Runs
                        </RouteLink>
                        <RouteLink
                          className="btn btn-primary"
                          onNavigate={onNavigate}
                          to={{
                            kind: 'session',
                            projectDir: s.projectDir,
                            sessionId: s.sessionId,
                          }}
                        >
                          Analytics
                        </RouteLink>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {totalPages > 1 && (
          <div className="badge-row" style={{ justifyContent: 'center', gap: 12, marginTop: 16 }}>
            <button className="btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              ← Prev
            </button>
            <span className="insight-meta">
              Page {page} of {totalPages} ({total} sessions)
            </span>
            <button
              className="btn"
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

export function SessionsPage({ onNavigate, initialProjectDir }: Props) {
  if (initialProjectDir) {
    return (
      <ProjectSessions
        projectDir={initialProjectDir}
        onBack={() => onNavigate({ kind: 'projects' })}
        onNavigate={onNavigate}
      />
    );
  }

  return (
    <ProjectList onSelect={(projectDir) => onNavigate({ kind: 'projects-detail', projectDir })} />
  );
}
