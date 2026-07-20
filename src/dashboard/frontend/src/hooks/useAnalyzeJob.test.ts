/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAnalyzeJob } from './useAnalyzeJob';

// @vitest-environment jsdom
vi.mock('../api', () => ({
  postAnalyzeSession: vi.fn(),
  fetchAnalyzeJob: vi.fn(),
}));

import * as api from '../api';

describe('useAnalyzeJob', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initializes with empty jobs', () => {
    const { result } = renderHook(() => useAnalyzeJob());
    expect(result.current.jobs).toEqual({});
  });

  it('sets status to queued synchronously on start', () => {
    const { result } = renderHook(() => useAnalyzeJob());
    act(() => {
      result.current.start('job1', 'my-dir', 'session-123');
    });
    expect(result.current.jobs.job1).toEqual({ status: 'queued' });
  });

  it('transitions to running after postAnalyzeSession resolves', async () => {
    const { result } = renderHook(() => useAnalyzeJob());
    vi.mocked(api.postAnalyzeSession).mockResolvedValue({ jobId: 'remote-1' });

    act(() => {
      result.current.start('job1', 'my-dir', 'session-123');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.jobs.job1).toEqual({ status: 'running' });
  });

  it('polls fetchAnalyzeJob on timer advances', async () => {
    const { result } = renderHook(() => useAnalyzeJob());
    vi.mocked(api.postAnalyzeSession).mockResolvedValue({ jobId: 'remote-1' });
    vi.mocked(api.fetchAnalyzeJob).mockResolvedValue({ status: 'running' });

    act(() => {
      result.current.start('job1', 'my-dir', 'session-123');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(vi.mocked(api.fetchAnalyzeJob)).toHaveBeenCalled();
    expect(result.current.jobs.job1).toEqual({ status: 'running' });
  });

  it('clears interval and fires onDone when job reaches done', async () => {
    const onDone = vi.fn();
    const { result } = renderHook(() => useAnalyzeJob(onDone));
    vi.mocked(api.postAnalyzeSession).mockResolvedValue({ jobId: 'remote-1' });
    vi.mocked(api.fetchAnalyzeJob).mockResolvedValue({ status: 'done' });

    act(() => {
      result.current.start('job1', 'my-dir', 'session-123');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(onDone).toHaveBeenCalled();
    expect(result.current.jobs.job1).toEqual({ status: 'done' });

    const fetchCallsBefore = vi.mocked(api.fetchAnalyzeJob).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(vi.mocked(api.fetchAnalyzeJob).mock.calls.length).toBe(fetchCallsBefore);
  });

  it('clears interval without firing onDone when job fails', async () => {
    const onDone = vi.fn();
    const { result } = renderHook(() => useAnalyzeJob(onDone));
    vi.mocked(api.postAnalyzeSession).mockResolvedValue({ jobId: 'remote-1' });
    vi.mocked(api.fetchAnalyzeJob).mockResolvedValue({ status: 'failed' });

    act(() => {
      result.current.start('job1', 'my-dir', 'session-123');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(onDone).not.toHaveBeenCalled();
    expect(result.current.jobs.job1).toEqual({ status: 'failed' });
  });

  it('marks job as failed if postAnalyzeSession rejects', async () => {
    const { result } = renderHook(() => useAnalyzeJob());
    vi.mocked(api.postAnalyzeSession).mockRejectedValue(new Error('Network error'));

    act(() => {
      result.current.start('job1', 'my-dir', 'session-123');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.jobs.job1?.status).toBe('failed');
    expect(result.current.jobs.job1?.error).toBeDefined();
  });

  it('marks job as failed if fetchAnalyzeJob rejects mid-poll', async () => {
    const { result } = renderHook(() => useAnalyzeJob());
    vi.mocked(api.postAnalyzeSession).mockResolvedValue({ jobId: 'remote-1' });
    vi.mocked(api.fetchAnalyzeJob).mockRejectedValue(new Error('Poll error'));

    act(() => {
      result.current.start('job1', 'my-dir', 'session-123');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(result.current.jobs.job1?.status).toBe('failed');
    expect(result.current.jobs.job1?.error).toBeDefined();
  });

  it('tracks multiple concurrent jobs with independent timers', async () => {
    const { result } = renderHook(() => useAnalyzeJob());
    vi.mocked(api.postAnalyzeSession).mockResolvedValue({ jobId: 'remote-id' });
    vi.mocked(api.fetchAnalyzeJob)
      .mockResolvedValueOnce({ status: 'running' })
      .mockResolvedValueOnce({ status: 'done' });

    act(() => {
      result.current.start('job1', 'dir1', 'session-1');
      result.current.start('job2', 'dir2', 'session-2');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(Object.keys(result.current.jobs)).toHaveLength(2);
    expect(result.current.jobs.job1?.status).toBe('running');
    expect(result.current.jobs.job2?.status).toBe('running');
  });
});
