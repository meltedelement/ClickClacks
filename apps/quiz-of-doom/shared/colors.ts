// The colours a team can pick. Each colour belongs to one team at most. The
// game draws the team's ball in it, with the HP in white on top, so every
// colour is mid-tone: bright enough on the dark arena, dark enough for white text.

export interface TeamColor {
  hex: string; // what Team.color stores and the game receives
  name: string;
}

export const TEAM_COLORS: TeamColor[] = [
  { hex: '#e5484d', name: 'Red' },
  { hex: '#ef7d2d', name: 'Orange' },
  { hex: '#d19a15', name: 'Gold' },
  { hex: '#8a9a2a', name: 'Olive' },
  { hex: '#6bb52f', name: 'Lime' },
  { hex: '#2fa35a', name: 'Green' },
  { hex: '#1f9e93', name: 'Teal' },
  { hex: '#1f95c9', name: 'Sky' },
  { hex: '#3e63dd', name: 'Blue' },
  { hex: '#6e56cf', name: 'Indigo' },
  { hex: '#a14bd1', name: 'Purple' },
  { hex: '#d6409f', name: 'Pink' },
  { hex: '#e8667a', name: 'Rose' },
  { hex: '#9a2f3c', name: 'Maroon' },
  { hex: '#9a6a45', name: 'Brown' },
  { hex: '#6f7a88', name: 'Slate' },
];

export function colorName(hex: string): string {
  return TEAM_COLORS.find((c) => c.hex === hex)?.name ?? hex;
}
