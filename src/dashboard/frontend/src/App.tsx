import { useRoute, type Route } from './hooks/useRoute';
import { EngagementPage } from './pages/EngagementPage';
import { SessionsPage } from './pages/SessionsPage';
import { SessionDetailPage } from './pages/SessionDetailPage';
import { BriefsPage } from './pages/BriefsPage';
import { BriefDetailPage } from './pages/BriefDetailPage';
import { GlobalSearch } from './components/GlobalSearch';
import type { AnalyticsFilter } from './types';

function routeToFilter(route: Route): AnalyticsFilter {
  switch (route.kind) {
    case 'holistic':
    case 'projects':
    case 'projects-detail':
    case 'session-detail':
    case 'briefs':
    case 'brief-detail':
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
    case 'briefs':
      return 'Briefs';
    case 'brief-detail':
      return route.date;
  }
}

interface Crumb {
  label: string;
  route?: Route; // omitted for the current/last crumb (not clickable)
}

function buildCrumbs(route: Route): Crumb[] {
  const crumbs: Crumb[] = [{ label: 'Holistic', route: { kind: 'holistic' } }];

  switch (route.kind) {
    case 'holistic':
      break;
    case 'projects':
      crumbs.push({ label: 'Projects' });
      break;
    case 'projects-detail':
      crumbs.push({ label: 'Projects', route: { kind: 'projects' } });
      crumbs.push({ label: route.projectDir });
      break;
    case 'session-detail':
      crumbs.push({ label: 'Projects', route: { kind: 'projects' } });
      crumbs.push({
        label: route.projectDir,
        route: { kind: 'projects-detail', projectDir: route.projectDir },
      });
      crumbs.push({ label: route.sessionId });
      break;
    case 'session':
      crumbs.push({ label: 'Projects', route: { kind: 'projects' } });
      crumbs.push({
        label: route.projectDir,
        route: { kind: 'projects-detail', projectDir: route.projectDir },
      });
      crumbs.push({
        label: route.sessionId,
        route: {
          kind: 'session-detail',
          projectDir: route.projectDir,
          sessionId: route.sessionId,
        },
      });
      break;
    case 'session-run':
      crumbs.push({ label: 'Projects', route: { kind: 'projects' } });
      crumbs.push({
        label: route.projectDir,
        route: { kind: 'projects-detail', projectDir: route.projectDir },
      });
      crumbs.push({
        label: route.sessionId,
        route: {
          kind: 'session-detail',
          projectDir: route.projectDir,
          sessionId: route.sessionId,
        },
      });
      crumbs.push({ label: route.label });
      break;
    case 'project':
      crumbs.push({ label: route.projectDir });
      break;
    case 'label':
      crumbs.push({ label: `Run: ${route.label}` });
      break;
    case 'briefs':
      crumbs.push({ label: 'Briefs' });
      break;
    case 'brief-detail':
      crumbs.push({ label: 'Briefs', route: { kind: 'briefs' } });
      crumbs.push({ label: route.date });
      break;
  }

  return crumbs;
}

export function App() {
  const [route, setRoute] = useRoute();
  const crumbs = buildCrumbs(route);

  return (
    <div className="container">
      <header>
        <div className="title-group">
          <h1>Pensieve</h1>
          <p>Daily insight analytics</p>
        </div>
        <nav className="main-nav">
          <button
            className={`nav-button ${route.kind === 'holistic' ? 'active' : ''}`}
            onClick={() => setRoute({ kind: 'holistic' })}
          >
            Engagement
          </button>
          <button
            className={`nav-button ${
              route.kind === 'projects' || route.kind === 'projects-detail' ? 'active' : ''
            }`}
            onClick={() => setRoute({ kind: 'projects' })}
          >
            Sessions
          </button>
          <button
            className={`nav-button ${
              route.kind === 'briefs' || route.kind === 'brief-detail' ? 'active' : ''
            }`}
            onClick={() => setRoute({ kind: 'briefs' })}
          >
            Briefs
          </button>
        </nav>
        <GlobalSearch onNavigate={setRoute} />
      </header>

      <nav className="breadcrumb">
        {crumbs.map((crumb, idx) => (
          <span key={idx} style={{ display: 'contents' }}>
            {idx > 0 && <span className="crumb-sep">›</span>}
            {crumb.route ? (
              <button className="crumb" onClick={() => setRoute(crumb.route!)}>
                {crumb.label}
              </button>
            ) : (
              <span className="crumb-current">{crumb.label}</span>
            )}
          </span>
        ))}
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
      ) : route.kind === 'briefs' ? (
        <BriefsPage onNavigate={setRoute} />
      ) : route.kind === 'brief-detail' ? (
        <BriefDetailPage date={route.date} onNavigate={setRoute} />
      ) : (
        <EngagementPage
          filter={routeToFilter(route)}
          scopeLabel={routeScopeLabel(route)}
          route={route}
        />
      )}
    </div>
  );
}
