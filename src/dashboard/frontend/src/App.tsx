import { useRoute, type Route } from './hooks/useRoute';
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
