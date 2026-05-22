import { Router } from "express";
import { randomUUID } from "crypto";
import { hashPassword, verifyPassword, createToken, extractToken, verifyToken } from "../lib/auth.js";
import { findUserByUsername, findUserById, saveUser } from "../data/db.js";
import { getRankByXP } from "../lib/ranks.js";
import type { User } from "../data/db.js";

const router = Router();

router.post("/auth/register", (req, res) => {
  const { username, email = "", password } = req.body as Record<string, string>;
  if (!username || !password) {
    res.status(400).json({ error: "Kullanıcı adı ve şifre gerekli" });
    return;
  }
  if (username.length < 3 || username.length > 24) {
    res.status(400).json({ error: "Kullanıcı adı 3-24 karakter olmalı" });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: "Şifre en az 6 karakter olmalı" });
    return;
  }
  if (!/^[a-zA-Z0-9_\-\.ğüşıöçĞÜŞİÖÇ]+$/.test(username)) {
    res.status(400).json({ error: "Kullanıcı adı sadece harf, rakam ve _-. içerebilir" });
    return;
  }
  const existing = findUserByUsername(username);
  if (existing) {
    res.status(409).json({ error: "Bu kullanıcı adı zaten alınmış" });
    return;
  }
  const { hash, salt } = hashPassword(password);
  const user: User = {
    id: randomUUID(),
    username,
    email,
    passwordHash: hash,
    salt,
    createdAt: new Date().toISOString(),
    xp: 0,
    rankId: 0,
    coins: 200,
    gamesPlayed: 0,
    kills: 0,
    deaths: 0,
    bestScore: 0,
    timePlayed: 0,
    ownedItems: [],
    equippedItems: {},
    lastXpUpdate: 0,
  };
  saveUser(user);
  const token = createToken({ id: user.id, username: user.username, rankId: user.rankId });
  res.json({
    token,
    user: publicUser(user),
  });
});

router.post("/auth/login", (req, res) => {
  const { username, password } = req.body as Record<string, string>;
  if (!username || !password) {
    res.status(400).json({ error: "Kullanıcı adı ve şifre gerekli" });
    return;
  }
  const user = findUserByUsername(username);
  if (!user) {
    res.status(401).json({ error: "Kullanıcı adı veya şifre yanlış" });
    return;
  }
  if (!verifyPassword(password, user.passwordHash, user.salt)) {
    res.status(401).json({ error: "Kullanıcı adı veya şifre yanlış" });
    return;
  }
  const token = createToken({ id: user.id, username: user.username, rankId: user.rankId });
  res.json({ token, user: publicUser(user) });
});

router.get("/auth/me", (req, res) => {
  const token = extractToken(req);
  if (!token) { res.status(401).json({ error: "Token gerekli" }); return; }
  const payload = verifyToken(token);
  if (!payload) { res.status(401).json({ error: "Geçersiz veya süresi dolmuş token" }); return; }
  const user = findUserById(payload.id);
  if (!user) { res.status(404).json({ error: "Kullanıcı bulunamadı" }); return; }
  res.json({ user: publicUser(user) });
});

router.post("/auth/logout", (_req, res) => {
  res.json({ ok: true });
});

function publicUser(user: User) {
  const rank = getRankByXP(user.xp);
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    xp: user.xp,
    rankId: rank.id,
    rankName: rank.name,
    rankEmoji: rank.emoji,
    rankColor: rank.color,
    coins: user.coins,
    gamesPlayed: user.gamesPlayed,
    kills: user.kills,
    deaths: user.deaths,
    bestScore: user.bestScore,
    timePlayed: user.timePlayed,
    ownedItems: user.ownedItems,
    equippedItems: user.equippedItems,
    createdAt: user.createdAt,
  };
}

export { publicUser };
export default router;
