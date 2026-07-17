import type { MouseEvent, ReactNode } from 'react';
import { routeToPath, type Route } from '../hooks/useRoute';

interface Props {
  to: Route;
  onNavigate: (route: Route) => void;
  className?: string;
  children: ReactNode;
}

/** An <a> that renders a real, bookmarkable path but navigates client-side (no full reload). */
export function RouteLink({ to, onNavigate, className, children }: Props) {
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // Let modifier-clicks (open in new tab, etc.) fall through to native behavior.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onNavigate(to);
  };

  return (
    <a href={routeToPath(to)} className={className} onClick={handleClick}>
      {children}
    </a>
  );
}
