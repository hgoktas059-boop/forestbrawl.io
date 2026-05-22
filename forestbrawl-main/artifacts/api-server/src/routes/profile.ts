import { Router } from "express";
import { extractToken, verifyToken, createToken } from "../lib/auth.js";
import { findUserById, saveUser } from "../data/db.js";
import { getRankByXP, getNextRank, getLevelByXP, RANKS } from "../lib/ranks.js";
import { publicUser } from "./auth.js";
import { updateLeaderboardEntry } from "./leaderboard.js";

const router = Router();

const XP_RATE_LIMIT_MS = 3_000;
const MAX_XP_PER_SUBMISSION = 5000;

router.get("/profile", (req, res) => {
  const token = extractToken(req);
  if (!token) { res.status(401).json({ error: "Token gerekli" }); return; }
  const payload = verifyToken(token);
  if (!payload) { res.status(401).json({ error: "Geçersiz token" }); return; }
  const user = findUserById(payload.id);
  if (!user) { res.status(404).json({ error: "Kullanıcı bulunamadı" }); return; }

  const rank = getRankByXP(user.xp);
  const nextRank = getNextRank(rank.id);
  const level = getLevelByXP(user.xp);
  const allRanks = RANKS;

  res.json({
    user: publicUser(user),
    rank,
    nextRank,
    level,
    allRanks,
    xpToNextRank: nextRank ? nextRank.minXP - user.xp : 0,
    xpProgress: nextRank
      ? (user.xp - rank.minXP) / (nextRank.minXP - rank.minXP)
      : 1,
  });
});

router.post("/profile/xp", (req, res) => {
  const token = extractToken(req);
  if (!token) { res.status(401).json({ error: "Token gerekli" }); return; }
  const payload = verifyToken(token);
  if (!payload) { res.status(401).json({ error: "Geçersiz token" }); return; }

  const user = findUserById(payload.id);
  if (!user) { res.status(404).json({ error: "Kullanıcı bulunamadı" }); return; }

  const now = Date.now();
  if (now - user.lastXpUpdate < XP_RATE_LIMIT_MS) {
    res.status(429).json({ error: "Çok hızlı XP gönderimi" });
    return;
  }

  const body = req.body as {
    xp?: number;
    kills?: number;
    deaths?: number;
    score?: number;
    timePlayed?: number;
    coins?: number;
  };

  const xpGain = Math.max(0, Math.min(MAX_XP_PER_SUBMISSION, Math.floor(body.xp ?? 0)));
  const killsGain = Math.max(0, Math.floor(body.kills ?? 0));
  const deathsGain = Math.max(0, Math.floor(body.deaths ?? 0));
  const scoreGain = Math.max(0, Math.floor(body.score ?? 0));
  const timeGain = Math.max(0, Math.floor(body.timePlayed ?? 0));
  const coinsGain = Math.max(0, Math.min(10000, Math.floor(body.coins ?? 0)));

  const oldRank = getRankByXP(user.xp);
  user.xp += xpGain;
  user.kills += killsGain;
  user.deaths += deathsGain;
  user.gamesPlayed += deathsGain > 0 ? 1 : 0;
  user.timePlayed += timeGain;
  user.coins += coinsGain;
  if (scoreGain > user.bestScore) user.bestScore = scoreGain;
  user.lastXpUpdate = now;

  const newRank = getRankByXP(user.xp);
  user.rankId = newRank.id;

  saveUser(user);

  const newToken = createToken({ id: user.id, username: user.username, rankId: newRank.id });

  updateLeaderboardEntry({
    userId: user.id,
    username: user.username,
    rankId: newRank.id,
    score: user.xp,
    kills: user.kills,
  });

  const nextRank = getNextRank(newRank.id);
  res.json({
    ok: true,
    newXp: user.xp,
    rankId: newRank.id,
    rankName: newRank.name,
    rankEmoji: newRank.emoji,
    rankUp: newRank.id > oldRank.id,
    newRankName: newRank.id > oldRank.id ? newRank.name : null,
    newToken,
    xpToNextRank: nextRank ? nextRank.minXP - user.xp : 0,
    xpProgress: nextRank
      ? (user.xp - newRank.minXP) / (nextRank.minXP - newRank.minXP)
      : 1,
  });
});

router.put("/profile/equip", (req, res) => {
  const token = extractToken(req);
  if (!token) { res.status(401).json({ error: "Token gerekli" }); return; }
  const payload = verifyToken(token);
  if (!payload) { res.status(401).json({ error: "Geçersiz token" }); return; }

  const user = findUserById(payload.id);
  if (!user) { res.status(404).json({ error: "Kullanıcı bulunamadı" }); return; }

  const { equippedItems } = req.body as { equippedItems: Record<string, string> };
  if (equippedItems && typeof equippedItems === "object") {
    user.equippedItems = equippedItems;
    saveUser(user);
  }
  res.json({ ok: true, equippedItems: user.equippedItems });
});

export default router;
