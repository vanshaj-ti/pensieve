import { useCallback, useRef, useState } from 'react';
import { fetchAnalyzeJob, postAnalyzeSession } from '../api';
import type { AnalyzeJob } from '../types';

const POLL_INTERVAL_MS = 2000;

/** Starts an analyze job and polls it to completion, exposing live status per job key. */
export function useAnalyzeJob(onDone?: () => void) {
  const [jobs, setJobs] = useState<Record<string, AnalyzeJob>>({});
  const timers = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  const start = useCallback(
    async (key: string, projectDir: string, sessionId: string) => {
      setJobs((prev) => ({ ...prev, [key]: { status: 'queued' } }));
      try {
        const { jobId } = await postAnalyzeSession(projectDir, sessionId);
        setJobs((prev) => ({ ...prev, [key]: { status: 'running' } }));

        timers.current[key] = setInterval(async () => {
          try {
            const job = await fetchAnalyzeJob(jobId);
            setJobs((prev) => ({ ...prev, [key]: job }));
            if (job.status === 'done' || job.status === 'failed') {
              clearInterval(timers.current[key]);
              delete timers.current[key];
              if (job.status === 'done' && onDone) onDone();
            }
          } catch (err) {
            clearInterval(timers.current[key]);
            delete timers.current[key];
            setJobs((prev) => ({
              ...prev,
              [key]: { status: 'failed', error: err instanceof Error ? err.message : String(err) },
            }));
          }
        }, POLL_INTERVAL_MS);
      } catch (err) {
        setJobs((prev) => ({
          ...prev,
          [key]: { status: 'failed', error: err instanceof Error ? err.message : String(err) },
        }));
      }
    },
    [onDone],
  );

  return { jobs, start };
}
