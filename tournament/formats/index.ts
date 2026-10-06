// Every tournament format, by id. Add a new one here.
import type { FormatId, FormatInfo, FormatOptions } from '../../contracts/tournament.d.ts';
import { doubleElimination } from './double-elimination.ts';
import type { Format } from './Format.ts';
import { roundRobin } from './round-robin.ts';
import { singleElimination } from './single-elimination.ts';

export const FORMATS: Format[] = [doubleElimination, singleElimination, roundRobin];

export function getFormat(id: string): Format {
  const format = FORMATS.find((f) => f.id === id);
  if (!format) throw new Error(`Unknown format "${id}". Use one of: ${FORMATS.map((f) => f.id).join(', ')}`);
  return format;
}

export function formatInfo(format: Format): FormatInfo {
  return { id: format.id as FormatId, name: format.name, description: format.description, options: format.options };
}

// Options with every default filled in. Throws on a value out of range.
export function resolveOptions(options: FormatOptions | undefined): Required<FormatOptions> {
  const legs = options?.legs ?? 1;
  if (!Number.isInteger(legs) || legs < 1 || legs > 2) throw new Error('"options.legs" must be 1 or 2');
  return { legs };
}
