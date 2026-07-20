import { useEffect, useState } from 'react';
import { fetchBriefDates } from '../api';
import type { Route } from '../hooks/useRoute';

interface Props {
  onNavigate: (route: Route) => void;
}

export function BriefsPage({ onNavigate }: Props) {
  const [dates, setDates] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchBriefDates()
      .then(setDates)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load briefs'));
  }, []);

  if (error) {
    return <div className="error-banner">Failed to load briefs: {error}</div>;
  }

  if (!dates) {
    return null;
  }

  if (dates.length === 0) {
    return (
      <div className="empty-state" style={{ gridColumn: '1 / -1' }}>
        No briefs found.
      </div>
    );
  }

  return (
    <main>
      <section className="card span-full">
        <h2>Daily Briefs</h2>
        <ul className="insight-list">
          {dates.map((date) => (
            <li className="session-row" key={date}>
              <div className="session-row-main">
                <button
                  className="label-edit-btn"
                  style={{ fontSize: '0.9rem', textAlign: 'left' }}
                  onClick={() => onNavigate({ kind: 'brief-detail', date })}
                >
                  {date}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
