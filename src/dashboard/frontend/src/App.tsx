import { useEffect, useState } from 'react';
import { useRoute, type Route } from './hooks/useRoute';
import { fetchLabels, fetchProjects, fetchSessions } from './api';
import type { LabelSummary, ProjectSummary, SessionSummary } from './types';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { SessionsPage } from './pages/SessionsPage';
import { SessionDetailPage } from './pages/SessionDetailPage';
import type { AnalyticsFilter } from './types';

function routeToFilter(route: Route): AnalyticsFilter {
  switch (route.kind) {
    case 'holistic':
    case 'projects':
    case 'projects-detail':
    case 'session-detail':
      return {};
    case 'project':
      return { projectDir: route.projectDir };
    case 'session':
      return { projectDir: route.projectDir, sessionId: route.sessionId };
    case 'session-run':
      return { projectDir: route.projectDir, sessionId: route.sessionId, label: route.label };
    case 'label':
      return { label: route.label };
  }
}

function routeScopeLabel(route: Route): string {
  switch (route.kind) {
    case 'holistic':
      return 'All projects';
    case 'project':
      return route.projectDir;
    case 'session':
      return `${route.projectDir} · ${route.sessionId}`;
    case 'session-run':
      return `${route.projectDir} · ${route.sessionId} · ${route.label}`;
    case 'label':
      return `Run: ${route.label}`;
    case 'projects':
      return 'Projects';
    case 'projects-detail':
      return route.projectDir;
    case 'session-detail':
      return `${route.projectDir} · ${route.sessionId}`;
  }
}

export function App() {
  const [route, setRoute] = useRoute();
  const [labels, setLabels] = useState<LabelSummary[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);

  useEffect(() => {
    fetchLabels().then(setLabels).catch(console.error);
    fetchProjects().then(setProjects).catch(console.error);
  }, []);

  useEffect(() => {
    const projectDir = route.kind === 'project' || route.kind === 'session' ? route.projectDir : '';
    if (projectDir) {
      fetchSessions(projectDir).then(setSessions).catch(console.error);
    } else {
      setSessions([]);
    }
  }, [route]);

  const currentProjectDir =
    route.kind === 'project' || route.kind === 'session' ? route.projectDir : '';
  const currentSessionId = route.kind === 'session' ? route.sessionId : '';
  const currentLabel = route.kind === 'label' ? route.label : '';

  return (
    <div className="container">
      <header>
        <div className="title-group">
          <h1>Pensieve</h1>
          <p>Daily insight analytics</p>
        </div>

        <div className="filter-bar">
          <div className="filter-section">
            <label htmlFor="project-filter">Project</label>
            <select
              id="project-filter"
              value={currentProjectDir}
              onChange={(e) => {
                const value = e.target.value;
                if (!value) setRoute({ kind: 'holistic' });
                else setRoute({ kind: 'project', projectDir: value });
              }}
            >
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.projectDir} value={p.projectDir}>
                  {p.projectDir} ({p.count})
                </option>
              ))}
            </select>
          </div>

          <div className="filter-section">
            <label htmlFor="session-filter">Session</label>
            <select
              id="session-filter"
              disabled={!currentProjectDir}
              value={currentSessionId}
              onChange={(e) => {
                const value = e.target.value;
                if (!value && currentProjectDir) {
                  setRoute({ kind: 'project', projectDir: currentProjectDir });
                } else if (value) {
                  setRoute({ kind: 'session', projectDir: currentProjectDir, sessionId: value });
                }
              }}
            >
              <option value="">All sessions</option>
              {sessions.map((s) => (
                <option key={s.sessionId} value={s.sessionId}>
                  {s.sessionId} ({s.count})
                </option>
              ))}
            </select>
          </div>

          <div className="filter-section">
            <label htmlFor="label-filter">Run label</label>
            <select
              id="label-filter"
              value={currentLabel}
              onChange={(e) => {
                const value = e.target.value;
                if (!value) setRoute({ kind: 'holistic' });
                else setRoute({ kind: 'label', label: value });
              }}
            >
              <option value="">All runs</option>
              {labels.map((l) => (
                <option key={l.label} value={l.label}>
                  {l.label || '(default)'} ({l.count})
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <nav className="breadcrumb">
        <button
          className={route.kind === 'holistic' ? 'crumb active' : 'crumb'}
          onClick={() => setRoute({ kind: 'holistic' })}
        >
          Holistic
        </button>
        <span className="crumb-sep">›</span>
        <button
          className={
            route.kind === 'projects' || route.kind === 'projects-detail' ? 'crumb active' : 'crumb'
          }
          onClick={() => setRoute({ kind: 'projects' })}
        >
          Projects
        </button>
        {route.kind === 'projects-detail' && (
          <>
            <span className="crumb-sep">›</span>
            <span className="crumb-current">{route.projectDir}</span>
          </>
        )}
        {route.kind !== 'holistic' &&
          route.kind !== 'projects' &&
          route.kind !== 'projects-detail' && (
            <>
              <span className="crumb-sep">›</span>
              <span className="crumb-current">{routeScopeLabel(route)}</span>
            </>
          )}
      </nav>

      {route.kind === 'projects' ? (
        <SessionsPage onNavigate={setRoute} />
      ) : route.kind === 'projects-detail' ? (
        <SessionsPage onNavigate={setRoute} initialProjectDir={route.projectDir} />
      ) : route.kind === 'session-detail' ? (
        <SessionDetailPage
          projectDir={route.projectDir}
          sessionId={route.sessionId}
          onNavigate={setRoute}
        />
      ) : (
        <AnalyticsPage
          filter={routeToFilter(route)}
          scopeLabel={routeScopeLabel(route)}
          route={route}
        />
      )}
    </div>
  );
}
