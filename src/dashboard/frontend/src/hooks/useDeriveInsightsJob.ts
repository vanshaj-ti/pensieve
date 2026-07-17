import { useCallback, useRef, useState } from 'react';
import { fetchDeriveInsightsJob, postDeriveInsights } from '../api';
import type { AnalyzeJob } from '../types';

const POLL_INTERVAL_MS = 2000;

/** Starts a derive-insights job for one session/run and polls it to completion. */
export function useDeriveInsightsJob(onDone?: () => void) {
  const [job, setJob] = useState<AnalyzeJob | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = useCallback(
    async (projectDir: string, sessionId: string, label: string) => {
      setJob({ status: 'queued' });
      try {
        const { jobId } = await postDeriveInsights(projectDir, sessionId, label);
        setJob({ status: 'running' });

        timer.current = setInterval(async () => {
          try {
            const latest = await fetchDeriveInsightsJob(jobId);
            setJob(latest);
            if (latest.status === 'done' || latest.status === 'failed') {
              if (timer.current) clearInterval(timer.current);
              timer.current = null;
              if (latest.status === 'done' && onDone) onDone();
            }
          } catch (err) {
            if (timer.current) clearInterval(timer.current);
            timer.current = null;
            setJob({ status: 'failed', error: err instanceof Error ? err.message : String(err) });
          }
        }, POLL_INTERVAL_MS);
      } catch (err) {
        setJob({ status: 'failed', error: err instanceof Error ? err.message : String(err) });
      }
    },
    [onDone],
  );

  return { job, start };
}
