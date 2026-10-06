// The quiz's weapon and upgrade catalog.
//
// The source of truth is the game, so the quiz offers upgrades by their real
// ids, weapon fits, stack limits and requirements. The quiz does not talk to
// the game: at startup (and again whenever the game comes back) it reads the
// game's catalog through the tournament service (GET /api/host/catalog there).
// quiz/data/game.json is a generated offline fallback for when the game is not
// running; see scripts/sync-catalog.js.
import fs from 'node:fs';
import path from 'node:path';
import type { Catalog } from '../shared/types.ts';

const CATALOG_FILE = path.join(import.meta.dirname, '..', 'data', 'game.json');
const FETCH_TIMEOUT_MS = 5_000;

export interface CatalogSettings {
  upgradesPerCorrect: number;
  offerSize: number;
  exclude: string[]; // upgrade ids the quiz never offers, even when the game has them
}

interface UpgradeData {
  id: string;
  name: string;
  description?: string;
  weapons?: string[] | null;
  requires?: string[] | null;
  excludedBy?: string[] | null;
  maxStacks?: number | null;
}

// The shape of data/game.json (and of GET /api/catalog, with nulls for "none").
interface CatalogData {
  upgradesPerCorrect?: number;
  offerSize?: number;
  exclude?: string[];
  weapons: { id: string; name: string }[];
  upgrades: UpgradeData[];
  transformations: UpgradeData[];
}

function readFile(): CatalogData {
  if (!fs.existsSync(CATALOG_FILE)) {
    throw new Error(`${CATALOG_FILE} is missing. Run \`npm run sync-catalog\` in quiz/.`);
  }
  return JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8')) as CatalogData;
}

// The quiz-only settings always come from the file; the game does not know them.
const file = readFile();

let current: Catalog = toCatalog(file, 'file', null);

export function getCatalog(): Catalog {
  return current;
}

export function getSettings(): CatalogSettings {
  return {
    upgradesPerCorrect: file.upgradesPerCorrect ?? 1,
    offerSize: file.offerSize ?? 3,
    exclude: file.exclude ?? [],
  };
}

// Reads the catalog from `apiUrl` + /catalog (the game's, through the
// tournament service). Returns true when the catalog in use is the
// game's, which it stays even if a later read fails — an older live catalog is
// closer to the truth than the file. Never throws: the quiz must still run the
// lobby while the game is down.
export async function refresh(apiUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${apiUrl}/catalog`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as CatalogData;
    if (!Array.isArray(data?.weapons) || !Array.isArray(data?.upgrades)) throw new Error('not a catalog');
    if (!Array.isArray(data.transformations)) throw new Error('not a catalog');
    current = toCatalog(data, 'game', new Date().toISOString());
  } catch {
    // Keep what we have.
  }
  return current.source === 'game';
}

function toCatalog(data: CatalogData, source: 'game' | 'file', syncedAt: string | null): Catalog {
  const exclude = new Set(file.exclude ?? []);
  const convert = (list: UpgradeData[]) =>
    list
      .filter((u) => !exclude.has(u.id))
      .map((u) => ({
        id: u.id,
        name: u.name,
        description: u.description ?? '',
        weapons: u.weapons && u.weapons.length > 0 ? u.weapons : undefined,
        requires: u.requires && u.requires.length > 0 ? u.requires : undefined,
        excludedBy: u.excludedBy && u.excludedBy.length > 0 ? u.excludedBy : undefined,
        maxStacks: u.maxStacks ?? undefined,
      }));
  return {
    weapons: data.weapons.map((w) => ({ id: w.id, name: w.name })),
    upgrades: convert(data.upgrades),
    transformations: convert(data.transformations),
    upgradesPerCorrect: file.upgradesPerCorrect ?? 1,
    offerSize: file.offerSize ?? 3,
    source,
    syncedAt,
  };
}
