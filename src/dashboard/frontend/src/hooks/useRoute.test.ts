import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRoute } from './useRoute';

// @vitest-environment jsdom
describe('useRoute', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('renders with initial route', () => {
    const { result } = renderHook(() => useRoute());
    expect(result.current[0]).toEqual({ kind: 'holistic' });
  });

  it('parses / as holistic', () => {
    const { result } = renderHook(() => useRoute());
    act(() => {
      window.history.pushState({}, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current[0]).toEqual({ kind: 'holistic' });
  });

  it('parses /projects', () => {
    const { result } = renderHook(() => useRoute());
    act(() => {
      window.history.pushState({}, '', '/projects');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current[0]).toEqual({ kind: 'projects' });
  });

  it('parses /projects/<dir>', () => {
    const { result } = renderHook(() => useRoute());
    act(() => {
      window.history.pushState({}, '', '/projects/my-dir');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current[0]).toEqual({ kind: 'projects-detail', projectDir: 'my-dir' });
  });

  it('parses /project/<dir>', () => {
    const { result } = renderHook(() => useRoute());
    act(() => {
      window.history.pushState({}, '', '/project/my-dir');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current[0]).toEqual({ kind: 'project', projectDir: 'my-dir' });
  });

  it('parses /project/<dir>/session/<id>', () => {
    const { result } = renderHook(() => useRoute());
    act(() => {
      window.history.pushState({}, '', '/project/my-dir/session/123');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current[0]).toEqual({
      kind: 'session',
      projectDir: 'my-dir',
      sessionId: '123',
    });
  });

  it('parses /project/<dir>/session/<id>/run/<label>', () => {
    const { result } = renderHook(() => useRoute());
    act(() => {
      window.history.pushState({}, '', '/project/my-dir/session/123/run/my-label');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current[0]).toEqual({
      kind: 'session-run',
      projectDir: 'my-dir',
      sessionId: '123',
      label: 'my-label',
    });
  });

  it('parses /session-detail/<dir>/<id>', () => {
    const { result } = renderHook(() => useRoute());
    act(() => {
      window.history.pushState({}, '', '/session-detail/my-dir/123');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current[0]).toEqual({
      kind: 'session-detail',
      projectDir: 'my-dir',
      sessionId: '123',
    });
  });

  it('parses /label/<label>', () => {
    const { result } = renderHook(() => useRoute());
    act(() => {
      window.history.pushState({}, '', '/label/my-label');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current[0]).toEqual({ kind: 'label', label: 'my-label' });
  });

  it('falls back to holistic for unrecognized paths', () => {
    const { result } = renderHook(() => useRoute());
    act(() => {
      window.history.pushState({}, '', '/unknown/path');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current[0]).toEqual({ kind: 'holistic' });
  });

  it('decodes URL-encoded segments', () => {
    const { result } = renderHook(() => useRoute());
    act(() => {
      window.history.pushState({}, '', '/project/my%2Fdir/session/my%20id');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current[0]).toEqual({
      kind: 'session',
      projectDir: 'my/dir',
      sessionId: 'my id',
    });
  });

  it('setRoute updates history and route', () => {
    const { result } = renderHook(() => useRoute());
    act(() => {
      result.current[1]({ kind: 'projects' });
    });
    expect(window.location.pathname).toBe('/projects');
    expect(result.current[0]).toEqual({ kind: 'projects' });
  });

  it('setRoute with projectDir encodes path segments', () => {
    const { result } = renderHook(() => useRoute());
    act(() => {
      result.current[1]({
        kind: 'session',
        projectDir: 'my/dir',
        sessionId: 'my id',
      });
    });
    expect(window.location.pathname).toBe('/project/my%2Fdir/session/my%20id');
  });

  it('setRoute does not push duplicate history entries', () => {
    const { result } = renderHook(() => useRoute());
    const initialLength = window.history.length;
    act(() => {
      result.current[1]({ kind: 'projects' });
    });
    const afterFirstCall = window.history.length;
    act(() => {
      result.current[1]({ kind: 'projects' });
    });
    const afterSecondCall = window.history.length;
    expect(afterFirstCall).toBe(initialLength + 1);
    expect(afterSecondCall).toBe(afterFirstCall);
  });
});
