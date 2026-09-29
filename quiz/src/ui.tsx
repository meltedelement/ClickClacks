// Small pieces shared by the team, admin and presenter pages.
import { useEffect, useState } from 'react';
import { TEAM_COLORS, colorName } from '../shared/colors.ts';

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

// A team's ball colour, next to its name.
export function TeamDot({ color }: { color: string }) {
  return <span className="team-dot" style={{ background: color || 'var(--faint)' }} title={color ? colorName(color) : 'No colour'} aria-hidden="true" />;
}

// One round button per colour. A colour another team has is crossed out and cannot be picked.
export function ColorPicker({ value, taken, onChange, disabled }: { value: string; taken: string[]; onChange: (hex: string) => void; disabled?: boolean }) {
  return (
    <fieldset disabled={disabled}>
      <legend className="label">Colour{value && <span className="muted"> · {colorName(value)}</span>}</legend>
      <div className="colors">
        {TEAM_COLORS.map((c) => {
          const isTaken = taken.includes(c.hex);
          return (
            <label key={c.hex} className="color" style={{ '--color': c.hex } as React.CSSProperties} title={isTaken ? `${c.name} (taken)` : c.name}>
              <input
                type="radio"
                name="color"
                value={c.hex}
                checked={value === c.hex}
                disabled={isTaken}
                onChange={() => onChange(c.hex)}
                aria-label={isTaken ? `${c.name}, taken by another team` : c.name}
              />
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

// A ball with one blade: the game in one mark. On a team's page the ball has the team's colour.
export function Brand({ name = 'Weapon Balls', color }: { name?: string; color?: string }) {
  return (
    <div className="brand">
      <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="9" cy="15" r="6" fill={color || 'var(--accent)'} />
        <path d="M13 11 21 3" stroke="var(--text)" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
      <span className="brand-name">{name}</span>
    </div>
  );
}

// The game's display page (?display), where the battles play. The quiz server
// may reach the game at 127.0.0.1, which is wrong for a browser on another
// device, so a loopback host becomes the host this page came from.
export function battleViewUrl(gameApi: string): string {
  const url = new URL(gameApi.replace(/\/api\/?$/, '/'), location.href);
  if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) url.hostname = location.hostname;
  url.search = '?display';
  return url.href;
}

export function BattleViewLink({ gameApi }: { gameApi: string }) {
  return (
    <a className="button" href={battleViewUrl(gameApi)} target="_blank" rel="noopener">
      Open battle view ↗
    </a>
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

// One segment per round, so the gaps show where each round starts and ends.
// Rounds before the current one are full; the current one fills up to `position`.
export function RoundProgress({ sizes, round, position, className }: { sizes: number[]; round: number; position: number; className?: string }) {
  return (
    <div className={className ? `round-progress ${className}` : 'round-progress'} aria-hidden="true">
      {sizes.map((size, i) => (
        <div key={i} style={{ flexGrow: size }}>
          <div style={{ width: `${i < round ? 100 : i === round ? (position / size) * 100 : 0}%` }} />
        </div>
      ))}
    </div>
  );
}
