export interface Rank {
  id: number;
  name: string;
  emoji: string;
  color: string;
  bgColor: string;
  border: string;
  minXP: number;
}

export const RANKS: Rank[] = [
  { id: 0,  name: 'Tohum',          emoji: '🌱', color: '#8bc34a', bgColor: 'rgba(139,195,74,0.18)',  border: '#4caf50',  minXP: 0 },
  { id: 1,  name: 'Taş',            emoji: '🪨', color: '#bdbdbd', bgColor: 'rgba(158,158,158,0.18)', border: '#757575',  minXP: 5000 },
  { id: 2,  name: 'Köylü',          emoji: '🪵', color: '#a1663a', bgColor: 'rgba(121,85,72,0.18)',   border: '#795548',  minXP: 20000 },
  { id: 3,  name: 'Acemi',          emoji: '🗡️', color: '#78909c', bgColor: 'rgba(96,125,139,0.18)',  border: '#546e7a',  minXP: 70000 },
  { id: 4,  name: 'Savaşçı',        emoji: '⚔️', color: '#42a5f5', bgColor: 'rgba(33,150,243,0.18)',  border: '#1976d2',  minXP: 200000 },
  { id: 5,  name: 'Muhafız',        emoji: '🛡️', color: '#66bb6a', bgColor: 'rgba(76,175,80,0.18)',   border: '#388e3c',  minXP: 600000 },
  { id: 6,  name: 'Ateş Efendisi',  emoji: '🔥', color: '#ff7043', bgColor: 'rgba(255,87,34,0.18)',   border: '#e64a19',  minXP: 1800000 },
  { id: 7,  name: 'Kristal',        emoji: '💎', color: '#26c6da', bgColor: 'rgba(0,188,212,0.18)',   border: '#0097a7',  minXP: 5000000 },
  { id: 8,  name: 'Fırtına',        emoji: '⚡', color: '#ab47bc', bgColor: 'rgba(156,39,176,0.18)',  border: '#7b1fa2',  minXP: 14000000 },
  { id: 9,  name: 'Gece Hanı',      emoji: '🌙', color: '#7986cb', bgColor: 'rgba(26,35,126,0.22)',   border: '#283593',  minXP: 40000000 },
  { id: 10, name: 'Efsane',         emoji: '👑', color: '#ffb300', bgColor: 'rgba(255,143,0,0.2)',    border: '#ff8f00',  minXP: 100000000 },
  { id: 11, name: 'Tanrısal',       emoji: '✨', color: '#ff80ab', bgColor: 'rgba(255,23,68,0.18)',   border: '#ff1744',  minXP: 250000000 },
];

export function getRankByXP(xp: number): Rank {
  let rank = RANKS[0];
  for (const r of RANKS) {
    if (xp >= r.minXP) rank = r;
    else break;
  }
  return rank;
}

export function getNextRank(rankId: number): Rank | null {
  if (rankId >= RANKS.length - 1) return null;
  return RANKS[rankId + 1];
}

export function getLevelByXP(xp: number): number {
  return Math.floor(Math.sqrt(xp / 50)) + 1;
}
