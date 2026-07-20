import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDeriveInsightsJob } from './useDeriveInsightsJob';

// @vitest-environment jsdom
vi.mock('../api', () => ({
  postDeriveInsights: vi.fn(),
  fetchDeriveInsightsJob: vi.fn(),
}));

import * as api from '../api';

describe('useDeriveInsightsJob', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initializes with null job', () => {
    const { result } = renderHook(() => useDeriveInsightsJob());
    expect(result.current.job).toBeNull();
  });

  it('sets status to queued synchronously on start', () => {
    const { result } = renderHook(() => useDeriveInsightsJob());
    act(() => {
      result.current.start('my-dir', 'session-123', 'my-label');
    });
    expect(result.current.job).toEqual({ status: 'queued' });
  });

  it('transitions to running after postDeriveInsights resolves', async () => {
    const { result } = renderHook(() => useDeriveInsightsJob());
    vi.mocked(api.postDeriveInsights).mockResolvedValue({ jobId: 'remote-1' });

    act(() => {
      result.current.start('my-dir', 'session-123', 'my-label');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.job).toEqual({ status: 'running' });
  });

  it('polls fetchDeriveInsightsJob on timer advances', async () => {
    const { result } = renderHook(() => useDeriveInsightsJob());
    vi.mocked(api.postDeriveInsights).mockResolvedValue({ jobId: 'remote-1' });
    vi.mocked(api.fetchDeriveInsightsJob).mockResolvedValue({ status: 'running' });

    act(() => {
      result.current.start('my-dir', 'session-123', 'my-label');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(vi.mocked(api.fetchDeriveInsightsJob)).toHaveBeenCalled();
    expect(result.current.job).toEqual({ status: 'running' });
  });

  it('clears timer and fires onDone when job reaches done', async () => {
    const onDone = vi.fn();
    const { result } = renderHook(() => useDeriveInsightsJob(onDone));
    vi.mocked(api.postDeriveInsights).mockResolvedValue({ jobId: 'remote-1' });
    vi.mocked(api.fetchDeriveInsightsJob).mockResolvedValue({ status: 'done' });

    act(() => {
      result.current.start('my-dir', 'session-123', 'my-label');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(onDone).toHaveBeenCalled();
    expect(result.current.job).toEqual({ status: 'done' });

    const fetchCallsBefore = vi.mocked(api.fetchDeriveInsightsJob).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(vi.mocked(api.fetchDeriveInsightsJob).mock.calls.length).toBe(fetchCallsBefore);
  });

  it('clears timer without firing onDone when job fails', async () => {
    const onDone = vi.fn();
    const { result } = renderHook(() => useDeriveInsightsJob(onDone));
    vi.mocked(api.postDeriveInsights).mockResolvedValue({ jobId: 'remote-1' });
    vi.mocked(api.fetchDeriveInsightsJob).mockResolvedValue({ status: 'failed' });

    act(() => {
      result.current.start('my-dir', 'session-123', 'my-label');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(onDone).not.toHaveBeenCalled();
    expect(result.current.job).toEqual({ status: 'failed' });
  });

  it('marks job as failed if postDeriveInsights rejects', async () => {
    const { result } = renderHook(() => useDeriveInsightsJob());
    vi.mocked(api.postDeriveInsights).mockRejectedValue(new Error('Network error'));

    act(() => {
      result.current.start('my-dir', 'session-123', 'my-label');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.job?.status).toBe('failed');
    expect(result.current.job?.error).toBeDefined();
  });

  it('marks job as failed if fetchDeriveInsightsJob rejects mid-poll', async () => {
    const { result } = renderHook(() => useDeriveInsightsJob());
    vi.mocked(api.postDeriveInsights).mockResolvedValue({ jobId: 'remote-1' });
    vi.mocked(api.fetchDeriveInsightsJob).mockRejectedValue(new Error('Poll error'));

    act(() => {
      result.current.start('my-dir', 'session-123', 'my-label');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(result.current.job?.status).toBe('failed');
    expect(result.current.job?.error).toBeDefined();
  });
});
