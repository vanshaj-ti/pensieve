import { useEffect, useState } from 'react';
import { fetchBrief } from '../api';
import type { Route } from '../hooks/useRoute';

interface Props {
  date: string;
  onNavigate: (route: Route) => void;
}

export function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Bold **text**
    const boldMatch = remaining.match(/^\*\*(.+?)\*\*/);
    if (boldMatch) {
      parts.push(<strong key={key++}>{boldMatch[1]}</strong>);
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic *text* or _text_
    const italicMatch = remaining.match(/^(\*|_)(.+?)\1/);
    if (italicMatch) {
      parts.push(<em key={key++}>{italicMatch[2]}</em>);
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Link [text](url)
    const linkMatch = remaining.match(/^\[(.+?)\]\((.+?)\)/);
    if (linkMatch) {
      parts.push(
        <a key={key++} href={linkMatch[2]}>
          {linkMatch[1]}
        </a>,
      );
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Regular text until next special char, or consume one char if pattern-matched but didn't match
    if (remaining[0].match(/[\*_\[]/)) {
      // Pattern char but no match: consume it literally
      parts.push(remaining[0]);
      remaining = remaining.slice(1);
    } else {
      const nextSpecialIdx = remaining.search(/[\*_\[]/);
      if (nextSpecialIdx === -1) {
        parts.push(remaining);
        remaining = '';
      } else {
        parts.push(remaining.slice(0, nextSpecialIdx));
        remaining = remaining.slice(nextSpecialIdx);
      }
    }
  }

  return parts.length === 1 ? parts[0] : parts;
}

export function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      const headingText = headingMatch[2];
      const Tag = `h${level}` as const;
      elements.push(<Tag key={i}>{renderInline(headingText)}</Tag>);
      i++;
      continue;
    }

    // Blockquotes
    if (line.match(/^>\s+/)) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].match(/^>\s+/)) {
        const quoteText = lines[i].replace(/^>\s+/, '');
        quoteLines.push(quoteText);
        i++;
      }
      elements.push(
        <blockquote key={elements.length} className="brief-blockquote">
          {quoteLines.map((q, idx) => (
            <p key={idx}>{renderInline(q)}</p>
          ))}
        </blockquote>,
      );
      continue;
    }

    // Code blocks
    if (line.startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing ```
      elements.push(
        <pre key={elements.length} className="brief-code-block">
          <code>{codeLines.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    // Horizontal rule
    if (line.match(/^(---|___|\*\*\*)\s*$/)) {
      elements.push(<hr key={elements.length} className="brief-hr" />);
      i++;
      continue;
    }

    // Unordered lists
    if (line.match(/^[\s]*[-*+]\s+/)) {
      const listItems: string[] = [];
      while (i < lines.length && lines[i].match(/^[\s]*[-*+]\s+/)) {
        const itemText = lines[i].replace(/^[\s]*[-*+]\s+/, '');
        listItems.push(itemText);
        i++;
      }
      elements.push(
        <ul key={elements.length}>
          {listItems.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // Ordered lists
    if (line.match(/^[\s]*\d+\.\s+/)) {
      const listItems: string[] = [];
      while (i < lines.length && lines[i].match(/^[\s]*\d+\.\s+/)) {
        const itemText = lines[i].replace(/^[\s]*\d+\.\s+/, '');
        listItems.push(itemText);
        i++;
      }
      elements.push(
        <ol key={elements.length}>
          {listItems.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // Multi-line paragraphs
    if (line.trim()) {
      const paragraphLines: string[] = [line];
      i++;
      while (
        i < lines.length &&
        lines[i].trim() &&
        !lines[i].match(/^(#{1,6}\s|```|>\s|[-*+]\s|\d+\.\s)/)
      ) {
        paragraphLines.push(lines[i]);
        i++;
      }
      elements.push(
        <p key={elements.length} className="brief-paragraph">
          {renderInline(paragraphLines.join(' '))}
        </p>,
      );
      continue;
    }

    i++;
  }

  return elements;
}

export function BriefDetailPage({ date, onNavigate }: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchBrief(date)
      .then((res) => setContent(res.content))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load brief'));
  }, [date]);

  if (error) {
    return <div className="error-banner">Failed to load brief: {error}</div>;
  }

  if (content === null) {
    return null;
  }

  return (
    <main>
      <section className="card span-full">{renderMarkdown(content)}</section>
    </main>
  );
}
