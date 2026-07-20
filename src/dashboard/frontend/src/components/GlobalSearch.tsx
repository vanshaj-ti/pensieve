import { useState, useEffect, useRef } from 'react';
import { SearchResult } from '../types';
import { fetchSearch } from '../api';
import { Route } from '../App';

interface GlobalSearchProps {
  onNavigate: (route: Route) => void;
}

export function GlobalSearch({ onNavigate }: GlobalSearchProps) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query.trim().toLowerCase());
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!debouncedQuery) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    setIsLoading(true);
    fetchSearch(debouncedQuery)
      .then((data) => {
        setResults(data);
        setIsOpen(true);
      })
      .catch(() => {
        setResults([]);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [debouncedQuery]);

  const handleResultClick = (result: SearchResult) => {
    if (result.type === 'project') {
      onNavigate({ kind: 'projects-detail', projectDir: result.projectDir });
    } else if (result.type === 'session') {
      onNavigate({
        kind: 'session-detail',
        projectDir: result.projectDir,
        sessionId: result.sessionId!,
      });
    } else if (result.type === 'insight') {
      onNavigate({
        kind: 'session-run',
        projectDir: result.projectDir,
        sessionId: result.sessionId!,
        label: result.label!,
      });
    }
    setQuery('');
    setDebouncedQuery('');
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  const handleBlur = () => {
    setTimeout(() => {
      setIsOpen(false);
    }, 200);
  };

  const handleFocus = () => {
    if (results.length > 0) {
      setIsOpen(true);
    }
  };

  const showEmpty = debouncedQuery && results.length === 0 && !isLoading;

  return (
    <div className="global-search">
      <input
        ref={inputRef}
        type="text"
        className="search-box"
        placeholder="Search projects, sessions, insights..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
      />
      {(isOpen || showEmpty) && (
        <div ref={dropdownRef} className="global-search-results">
          {isLoading && <div className="search-loading">Searching...</div>}
          {showEmpty && <div className="search-empty">No results</div>}
          {results.length > 0 && (
            <ul className="search-results-list">
              {results.map((result, idx) => (
                <li key={idx} className="search-result-row">
                  <button
                    className="search-result-button"
                    onClick={() => handleResultClick(result)}
                  >
                    <span className="search-result-text">{result.text}</span>
                    <span className={`search-result-badge badge-${result.type}`}>
                      {result.type === 'project'
                        ? 'Project'
                        : result.type === 'session'
                          ? 'Session'
                          : 'Insight'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
