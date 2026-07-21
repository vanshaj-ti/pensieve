export const EFFORT_COLORS = { toil: '#e8785a', judgment: '#4bab8c', overhead: '#e0b03e' };
export const ENGAGEMENT_COLORS = {
  directiveNecessary: '#e0b03e',
  directiveUnnecessary: '#e8785a',
  deliberative: '#4bab8c',
  corrective: '#6b9bd6',
  acknowledgment: '#8a8a92',
};
export const CATEGORY_COLORS = ['#5b5bd6', '#4bab8c', '#e8785a', '#e0b03e', '#6b9bd6', '#c46bd6'];

export function isDarkMode(): boolean {
  const themeAttr = document.documentElement.getAttribute('data-theme');
  if (themeAttr === 'dark') return true;
  if (themeAttr === 'light') return false;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function chartTextColor(): string {
  return isDarkMode() ? '#a3a3ad' : '#6b6b73';
}

export function chartGridColor(): string {
  return isDarkMode() ? '#2a2a33' : '#e5e5e8';
}
