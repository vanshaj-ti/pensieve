import { describe, it, expect } from 'vitest';
import { renderInline, renderMarkdown } from './BriefDetailPage';

// Flattens a React node tree into its visible text, for structural assertions
// without needing a DOM renderer.
function flattenText(node: unknown): string {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join('');
  if (typeof node === 'object' && node !== null && 'props' in node) {
    const props = (node as { props?: { children?: unknown } }).props;
    return flattenText(props?.children);
  }
  return '';
}

describe('renderInline', () => {
  it('does not crash on a bracketed non-link token like [5.0]', () => {
    expect(() => renderInline('significance [5.0] today')).not.toThrow();
    const result = renderInline('significance [5.0] today');
    expect(flattenText(result)).toBe('significance [5.0] today');
  });

  it('does not crash on an unpaired underscore', () => {
    expect(() => renderInline('an _unpaired underscore')).not.toThrow();
    const result = renderInline('an _unpaired underscore');
    expect(flattenText(result)).toBe('an _unpaired underscore');
  });

  it('does not crash on an unpaired asterisk', () => {
    expect(() => renderInline('an *unpaired asterisk')).not.toThrow();
    const result = renderInline('an *unpaired asterisk');
    expect(flattenText(result)).toBe('an *unpaired asterisk');
  });

  it('still renders bold text correctly', () => {
    const result = renderInline('this is **bold** text');
    expect(flattenText(result)).toBe('this is bold text');
  });

  it('still renders a real markdown link correctly', () => {
    const result = renderInline('see [docs](https://example.com) for more');
    expect(flattenText(result)).toBe('see docs for more');
  });
});

describe('renderMarkdown', () => {
  it('does not crash on a line containing a bracketed non-link token', () => {
    expect(() => renderMarkdown('Top significance [5.0] this week')).not.toThrow();
  });

  it('does not crash on multi-line content with mixed markdown-like tokens', () => {
    const text = ['# Heading', 'Some **bold** and [5.0] and an unpaired _ char.'].join('\n');
    expect(() => renderMarkdown(text)).not.toThrow();
  });
});
