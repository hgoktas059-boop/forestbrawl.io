import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const DATA_DIR = process.env["FB_DATA_DIR"] || join(process.cwd(), "data");

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

export function readDB<T>(name: string, defaultValue: T): T {
  ensureDir();
  const fp = join(DATA_DIR, `${name}.json`);
  if (!existsSync(fp)) return defaultValue;
  try {
    return JSON.parse(readFileSync(fp, "utf-8")) as T;
  } catch {
    return defaultValue;
  }
}

export function writeDB<T>(name: string, data: T): void {
  ensureDir();
  writeFileSync(
    join(DATA_DIR, `${name}.json`),
    JSON.stringify(data, null, 2)
  );
}

export interface User {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
  xp: number;
  rankId: number;
  coins: number;
  gamesPlayed: number;
  kills: number;
  deaths: number;
  bestScore: number;
  timePlayed: number;
  ownedItems: string[];
  equippedItems: Record<string, string>;
  lastXpUpdate: number;
}

export interface UsersDB {
  users: User[];
}

export interface LbEntry {
  userId: string;
  username: string;
  rankId: number;
  score: number;
  kills: number;
  updatedAt: string;
}

export interface LeaderboardDB {
  daily: LbEntry[];
  weekly: LbEntry[];
  all: LbEntry[];
  kills: LbEntry[];
  lastResetDaily: string;
  lastResetWeekly: string;
}

export function readUsers(): UsersDB {
  return readDB<UsersDB>("users", { users: [] });
}

export function writeUsers(db: UsersDB): void {
  writeDB("users", db);
}

export function findUserById(id: string): User | undefined {
  return readUsers().users.find((u) => u.id === id);
}

export function findUserByUsername(username: string): User | undefined {
  return readUsers()
    .users.find((u) => u.username.toLowerCase() === username.toLowerCase());
}

export function saveUser(user: User): void {
  const db = readUsers();
  const idx = db.users.findIndex((u) => u.id === user.id);
  if (idx >= 0) db.users[idx] = user;
  else db.users.push(user);
  writeUsers(db);
}

export function readLeaderboard(): LeaderboardDB {
  return readDB<LeaderboardDB>("leaderboard", {
    daily: [],
    weekly: [],
    all: [],
    kills: [],
    lastResetDaily: new Date().toISOString(),
    lastResetWeekly: new Date().toISOString(),
  });
}

export function writeLeaderboard(db: LeaderboardDB): void {
  writeDB("leaderboard", db);
}
