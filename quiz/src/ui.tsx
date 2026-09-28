// Small pieces shared by the team, admin and presenter pages.
import { useEffect, useState } from 'react';

export const LETTERS = 'ABCDEFGH';

// Colours taken from each weapon's draw code in the game, so a team sees the same colour in the arena.
const WEAPON_COLORS: Record<string, string> = {
  sword: '#c9a44c',
  spear: '#b07a44',
  mace: '#8d949c',
  daggers: '#e3e8ee',
};

export function WeaponSwatch({ id }: { id: string }) {
  return <span className="swatch" style={{ background: WEAPON_COLORS[id] ?? 'var(--faint)' }} aria-hidden="true" />;
}

// A ball with one blade: the game in one mark.
export function Brand({ name = 'Weapon Balls' }: { name?: string }) {
  return (
    <div className="brand">
      <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="9" cy="15" r="6" fill="var(--accent)" />
        <path d="M13 11 21 3" stroke="var(--text)" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
      <span className="brand-name">{name}</span>
    </div>
  );
}

export function Status({ connected }: { connected: boolean }) {
  return (
    <span className={connected ? 'status' : 'status off'} role="status">
      {connected ? 'Live' : 'Reconnecting…'}
    </span>
  );
}

const THEME_KEY = 'quiz-theme';
type Theme = 'light' | 'dark';

function systemTheme(): Theme {
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function savedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

// index.html sets the first theme before React loads. This button switches it and saves the choice.
// With no saved choice, the page follows the system setting, also when it changes.
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme as Theme) ?? 'dark');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: light)');
    const onChange = () => savedTheme() || setTheme(systemTheme());
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    try {
      // Choosing the system theme again clears the saved choice, so the page follows the system from then on.
      if (next === systemTheme()) localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage can be blocked. The theme still changes for this visit.
    }
    setTheme(next);
  }

  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <button type="button" className="theme-toggle" onClick={toggle} aria-label={label} title={label}>
      {theme === 'dark' ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />
        </svg>
      )}
    </button>
  );
}
