import { useCallback, useEffect, useRef, useState } from 'react';
import type { Route } from '../hooks/useRoute';
import type {
  AnalyticsFilter,
  DateRange,
  EngagementBreakdown,
  EngagementBreakdownTrendPoint,
} from '../types';
import { fetchDates, fetchEngagementBreakdown, fetchEngagementBreakdownTrend } from '../api';
import { EngagementStatStrip } from '../components/EngagementStatStrip';
import { EngagementSummary } from '../components/EngagementSummary';
import { EngagementBreakdownChart } from '../components/EngagementBreakdownChart';
import { EngagementTrendChart } from '../components/EngagementTrendChart';
import { FlaggedDirectivesList } from '../components/FlaggedDirectivesList';

interface Props {
  filter: AnalyticsFilter;
  scopeLabel: string;
  route: Route;
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

const TREND_DAYS = 30;

export function EngagementPage({ filter, scopeLabel }: Props) {
  const [preset, setPreset] = useState<'today' | '7d' | '30d' | 'custom'>('today');
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');
  const [dates, setDates] = useState<string[]>([]);
  const [breakdown, setBreakdown] = useState<EngagementBreakdown | null>(null);
  const [trend, setTrend] = useState<EngagementBreakdownTrendPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const reloadAbortRef = useRef<AbortController | null>(null);

  const filterKey = JSON.stringify(filter);

  useEffect(() => {
    let cancelled = false;
    fetchDates(filter)
      .then((d) => {
        if (cancelled) return;
        setDates(d);
        if (d.length > 0) {
          setCustomFrom((prev) => prev || d[0]);
          setCustomTo((prev) => prev || d[0]);
        }
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
    // filterKey is a stable JSON-stringified proxy for filter's identity;
    // intentionally excluding `filter` itself (see AnalyticsPage's original
    // rationale, same pattern reused here) to avoid re-running on every
    // render.
  }, [filterKey]);

  const reload = useCallback(() => {
    if (dates.length === 0) return;
    let range: DateRange | null = null;
    if (preset === 'today') {
      range = { date: dates[0] };
    } else if (preset === '7d') {
      const from = shiftDate(dates[0], -6);
      range = { fromDate: from, toDate: dates[0] };
    } else if (preset === '30d') {
      const from = shiftDate(dates[0], -29);
      range = { fromDate: from, toDate: dates[0] };
    } else if (customFrom && customTo && customFrom <= customTo) {
      range = { fromDate: customFrom, toDate: customTo };
    }
    if (!range) return;
    setError(null);
    reloadAbortRef.current?.abort();
    const abortController = new AbortController();
    reloadAbortRef.current = abortController;
    fetchEngagementBreakdown(range, filter)
      .then((res) => {
        if (abortController.signal.aborted) return;
        setBreakdown(res);
      })
      .catch((err) => {
        if (abortController.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Failed to load data');
      });
  }, [preset, customFrom, customTo, dates, filterKey, filter]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Trend always covers a fixed lookback window, independent of the
  // preset/custom-range selector above — the whole point of a trend view
  // is to show change over a stable window, not to shrink/grow with
  // whatever single-point range the user is currently looking at.
  useEffect(() => {
    let cancelled = false;
    fetchEngagementBreakdownTrend(TREND_DAYS, filter)
      .then((res) => {
        if (!cancelled) setTrend(res);
      })
      .catch(() => {
        // Trend is additive polish, same as the old EffortTrendChart —
        // a failure here shouldn't block the rest of the page.
      });
    return () => {
      cancelled = true;
    };
  }, [filterKey, filter]);

  useEffect(() => {
    return () => {
      reloadAbortRef.current?.abort();
    };
  }, []);

  if (error) {
    return <div className="error-banner">Failed to load dashboard: {error}</div>;
  }

  if (dates.length === 0) {
    return (
      <div className="empty-state">
        No data yet for {scopeLabel} — run `pensieve analyze` first.
      </div>
    );
  }

  if (!breakdown) {
    return <div className="loading-state">Loading…</div>;
  }

  return (
    <>
      <div className="date-range-selector">
        <button onClick={() => setPreset('today')} className={preset === 'today' ? 'active' : ''}>
          Today
        </button>
        <button onClick={() => setPreset('7d')} className={preset === '7d' ? 'active' : ''}>
          7d
        </button>
        <button onClick={() => setPreset('30d')} className={preset === '30d' ? 'active' : ''}>
          30d
        </button>
        <button onClick={() => setPreset('custom')} className={preset === 'custom' ? 'active' : ''}>
          Custom
        </button>
        {preset === 'custom' && (
          <div className="custom-date-inputs">
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            <span>–</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </div>
        )}
      </div>
      <main className="analytics-grid">
        <EngagementStatStrip breakdown={breakdown} />

        <section className="card span-full">
          <h2>Summary</h2>
          <EngagementSummary breakdown={breakdown} />
        </section>

        <section className="card span-full">
          <h2>
            Trend
            <span className="card-hint">last {TREND_DAYS} days</span>
          </h2>
          <EngagementTrendChart data={trend} />
        </section>

        <section className="card span-full">
          <h2>
            Engagement Breakdown
            <span className="card-hint">
              {preset === 'today'
                ? 'today'
                : preset === '7d'
                  ? 'last 7 days'
                  : preset === '30d'
                    ? 'last 30 days'
                    : `${customFrom} – ${customTo}`}
            </span>
          </h2>
          <div className="chart-wrap">
            <EngagementBreakdownChart data={breakdown} />
          </div>
        </section>

        <section className="card span-full">
          <h2>Flagged Babysitting Turns</h2>
          <FlaggedDirectivesList flaggedDirectives={breakdown.flaggedDirectives} />
        </section>
      </main>
    </>
  );
}
