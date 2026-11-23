// How the host dresses up a player's ball: a colour, a skin and a tag before the
// name ("DEV · Ana"). Looks only: the game never lets them change a fight. The
// skins are the game's (`Skin` in its api/game.d.ts); the host page's picker
// lists the same ones, with presets (client/ui.js, LOOK_PRESETS).
import type { Skin } from '../../../games/weapon-balls/api/game.d.ts';

export const SKINS: readonly Skin[] = ['gold', 'birthday', 'rainbow', 'galaxy', 'diamond', 'fire'];
export const MAX_TAG = 12; // the game's limit
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export interface Look {
  color: string;
  skin: Skin | null;
  tag: string | null;
}

// A look from what the host sent, on top of the current one: a field left out
// keeps its value, and null (or an empty tag) clears it. Throws with a message
// for the host when something doesn't fit.
export function changeLook(current: Look, change: unknown): Look {
  if (!change || typeof change !== 'object') throw new Error('Send a colour, skin or tag');
  const { color, skin, tag } = change as Record<string, unknown>;
  const next = { ...current };
  if (color !== undefined) {
    if (typeof color !== 'string' || !HEX_COLOR.test(color)) throw new Error('A colour looks like #e5484d');
    next.color = color.toLowerCase();
  }
  if (skin !== undefined) {
    if (skin !== null && !SKINS.includes(skin as Skin)) throw new Error('No such skin');
    next.skin = skin as Skin | null;
  }
  if (tag !== undefined) {
    if (tag !== null && typeof tag !== 'string') throw new Error('A tag is text');
    const trimmed = tag?.trim() ?? '';
    if ([...trimmed].length > MAX_TAG) throw new Error(`A tag is at most ${MAX_TAG} characters`);
    next.tag = trimmed || null;
  }
  return next;
}

// What a look adds to a fighter sent to the game, beside its colour.
export function lookFields(look: { skin: Skin | null; tag: string | null }): { skin?: Skin; tag?: string } {
  return { ...(look.skin ? { skin: look.skin } : {}), ...(look.tag ? { tag: look.tag } : {}) };
}
