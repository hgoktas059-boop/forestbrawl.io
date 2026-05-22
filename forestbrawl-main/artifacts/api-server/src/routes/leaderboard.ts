import { Router } from "express";
import { readLeaderboard, writeLeaderboard, type LbEntry, findUserById } from "../data/db.js";
import { verifyToken, extractToken } from "../lib/auth.js";

const router = Router();

function checkAndResetPeriods() {
  const db = readLeaderboard();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const lastDaily = db.lastResetDaily.slice(0, 10);
  if (today !== lastDaily) {
    db.daily = [];
    db.lastResetDaily = now.toISOString();
  }
  const weekStart = getWeekStart(now);
  const lastWeekStart = getWeekStart(new Date(db.lastResetWeekly));
  if (weekStart !== lastWeekStart) {
    db.weekly = [];
    db.lastResetWeekly = now.toISOString();
  }
  writeLeaderboard(db);
  return db;
}

function getWeekStart(d: Date): string {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(d);
  mon.setDate(diff);
  return mon.toISOString().slice(0, 10);
}

router.get("/leaderboard", (req, res) => {
  const tab = (req.query["tab"] as string) || "daily";
  const db = checkAndResetPeriods();
  const validTabs = ["daily", "weekly", "all", "kills"] as const;
  const key = validTabs.includes(tab as typeof validTabs[number])
    ? (tab as typeof validTabs[number])
    : "daily";

  const entries = db[key]
    .sort((a, b) => (key === "kills" ? b.kills - a.kills : b.score - a.score))
    .slice(0, 50)
    .map((e, i) => ({
      rank: i + 1,
      name: e.username,
      score: key === "kills" ? e.kills : e.score,
      kills: e.kills,
      rankId: e.rankId,
      userId: e.userId,
    }));

  res.json({ entries });
});

router.post("/leaderboard/submit", (req, res) => {
  const body = req.body as {
    name?: string;
    score?: number;
    kills?: number;
    token?: string;
    guestId?: string;
  };

  const rawScore = Math.max(0, Math.min(9_999_999, Math.floor(body.score ?? 0)));
  const rawKills = Math.max(0, Math.min(99_999, Math.floor(body.kills ?? 0)));
  const name = (body.name || "Misafir").slice(0, 24).trim() || "Misafir";

  let userId: string;
  let username: string;
  let rankId = 0;

  if (body.token) {
    const payload = verifyToken(body.token);
    if (payload) {
      const user = findUserById(payload.id);
      if (user) {
        userId = user.id;
        username = user.username;
        rankId = user.rankId ?? 0;
      } else {
        userId = `guest_${body.guestId || "anon"}`;
        username = name;
      }
    } else {
      userId = `guest_${body.guestId || "anon"}`;
      username = name;
    }
  } else {
    userId = `guest_${body.guestId || "anon"}`;
    username = name;
  }

  updateLeaderboardEntry({ userId, username, rankId, score: rawScore, kills: rawKills });
  res.json({ ok: true });
});

export function updateLeaderboardEntry(entry: Omit<LbEntry, "updatedAt">) {
  const db = checkAndResetPeriods();
  const updatedAt = new Date().toISOString();
  const full: LbEntry = { ...entry, updatedAt };

  for (const key of ["daily", "weekly", "all"] as const) {
    const idx = db[key].findIndex((e) => e.userId === entry.userId);
    if (idx >= 0) {
      if (entry.score > db[key][idx].score) db[key][idx] = full;
    } else {
      db[key].push(full);
    }
  }

  const killsIdx = db.kills.findIndex((e) => e.userId === entry.userId);
  if (killsIdx >= 0) {
    if (entry.kills > db.kills[killsIdx].kills) db.kills[killsIdx] = full;
  } else {
    db.kills.push(full);
  }

  writeLeaderboard(db);
}

export default router;
