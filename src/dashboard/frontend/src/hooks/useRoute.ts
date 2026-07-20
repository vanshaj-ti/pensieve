import { useEffect, useState } from 'react';

export type Route =
  | { kind: 'holistic' }
  | { kind: 'project'; projectDir: string }
  | { kind: 'session'; projectDir: string; sessionId: string }
  | { kind: 'label'; label: string }
  | { kind: 'projects' }
  | { kind: 'projects-detail'; projectDir: string }
  | { kind: 'session-detail'; projectDir: string; sessionId: string }
  | { kind: 'session-run'; projectDir: string; sessionId: string; label: string }
  | { kind: 'briefs' }
  | { kind: 'brief-detail'; date: string };

function parsePath(pathname: string): Route {
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);

  if (parts.length === 0) {
    return { kind: 'holistic' };
  }
  if (parts[0] === 'projects' && parts.length === 1) {
    return { kind: 'projects' };
  }
  if (parts[0] === 'projects' && parts[1] && parts.length === 2) {
    return { kind: 'projects-detail', projectDir: parts[1] };
  }
  if (parts[0] === 'session-detail' && parts[1] && parts[2]) {
    return { kind: 'session-detail', projectDir: parts[1], sessionId: parts[2] };
  }
  if (parts[0] === 'project' && parts[1]) {
    if (parts[2] === 'session' && parts[3]) {
      if (parts[4] === 'run' && parts[5]) {
        return {
          kind: 'session-run',
          projectDir: parts[1],
          sessionId: parts[3],
          label: parts[5],
        };
      }
      return { kind: 'session', projectDir: parts[1], sessionId: parts[3] };
    }
    return { kind: 'project', projectDir: parts[1] };
  }
  if (parts[0] === 'label' && parts[1]) {
    return { kind: 'label', label: parts[1] };
  }
  if (parts[0] === 'briefs' && parts.length === 1) {
    return { kind: 'briefs' };
  }
  if (parts[0] === 'briefs' && parts[1] && parts.length === 2) {
    return { kind: 'brief-detail', date: parts[1] };
  }
  return { kind: 'holistic' };
}

export function routeToPath(route: Route): string {
  switch (route.kind) {
    case 'holistic':
      return '/';
    case 'project':
      return `/project/${encodeURIComponent(route.projectDir)}`;
    case 'session':
      return `/project/${encodeURIComponent(route.projectDir)}/session/${encodeURIComponent(route.sessionId)}`;
    case 'label':
      return `/label/${encodeURIComponent(route.label)}`;
    case 'projects':
      return '/projects';
    case 'projects-detail':
      return `/projects/${encodeURIComponent(route.projectDir)}`;
    case 'session-detail':
      return `/session-detail/${encodeURIComponent(route.projectDir)}/${encodeURIComponent(route.sessionId)}`;
    case 'session-run':
      return `/project/${encodeURIComponent(route.projectDir)}/session/${encodeURIComponent(route.sessionId)}/run/${encodeURIComponent(route.label)}`;
    case 'briefs':
      return '/briefs';
    case 'brief-detail':
      return `/briefs/${encodeURIComponent(route.date)}`;
  }
}

export function useRoute(): [Route, (route: Route) => void] {
  const [route, setRouteState] = useState<Route>(() => parsePath(window.location.pathname));

  useEffect(() => {
    const onPopState = () => setRouteState(parsePath(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const setRoute = (next: Route) => {
    const path = routeToPath(next);
    if (path !== window.location.pathname) {
      window.history.pushState(null, '', path);
    }
    setRouteState(next);
  };

  return [route, setRoute];
}
