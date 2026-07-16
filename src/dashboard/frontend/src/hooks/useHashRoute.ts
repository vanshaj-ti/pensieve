import { useEffect, useState } from 'react';

export type Route =
  | { kind: 'holistic' }
  | { kind: 'project'; projectDir: string }
  | { kind: 'session'; projectDir: string; sessionId: string }
  | { kind: 'label'; label: string };

function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);

  if (parts.length === 0) {
    return { kind: 'holistic' };
  }
  if (parts[0] === 'project' && parts[1]) {
    if (parts[2] === 'session' && parts[3]) {
      return { kind: 'session', projectDir: parts[1], sessionId: parts[3] };
    }
    return { kind: 'project', projectDir: parts[1] };
  }
  if (parts[0] === 'label' && parts[1]) {
    return { kind: 'label', label: parts[1] };
  }
  return { kind: 'holistic' };
}

export function routeToHash(route: Route): string {
  switch (route.kind) {
    case 'holistic':
      return '#/';
    case 'project':
      return `#/project/${encodeURIComponent(route.projectDir)}`;
    case 'session':
      return `#/project/${encodeURIComponent(route.projectDir)}/session/${encodeURIComponent(route.sessionId)}`;
    case 'label':
      return `#/label/${encodeURIComponent(route.label)}`;
  }
}

export function useHashRoute(): [Route, (route: Route) => void] {
  const [route, setRouteState] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onHashChange = () => setRouteState(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const setRoute = (next: Route) => {
    window.location.hash = routeToHash(next);
  };

  return [route, setRoute];
}
