import { Router } from "express";
import { extractToken, verifyToken } from "../lib/auth.js";
import { findUserById, saveUser } from "../data/db.js";

const router = Router();

router.get("/shop/owned", (req, res) => {
  const token = extractToken(req);
  if (!token) { res.status(401).json({ error: "Token gerekli" }); return; }
  const payload = verifyToken(token);
  if (!payload) { res.status(401).json({ error: "Geçersiz token" }); return; }

  const user = findUserById(payload.id);
  if (!user) { res.status(404).json({ error: "Kullanıcı bulunamadı" }); return; }

  res.json({
    ownedItems: user.ownedItems,
    equippedItems: user.equippedItems,
    coins: user.coins,
  });
});

router.post("/shop/buy", (req, res) => {
  const token = extractToken(req);
  if (!token) { res.status(401).json({ error: "Token gerekli" }); return; }
  const payload = verifyToken(token);
  if (!payload) { res.status(401).json({ error: "Geçersiz token" }); return; }

  const user = findUserById(payload.id);
  if (!user) { res.status(404).json({ error: "Kullanıcı bulunamadı" }); return; }

  const { itemId, cost } = req.body as { itemId: string; cost: number };
  if (!itemId) { res.status(400).json({ error: "itemId gerekli" }); return; }

  const rawCost = Math.floor(cost ?? 0);
  if (rawCost < 50) {
    res.status(400).json({ error: "Geçersiz ürün fiyatı" });
    return;
  }
  const itemCost = Math.min(99999, rawCost);

  if (user.ownedItems.includes(itemId)) {
    res.json({ ok: true, alreadyOwned: true, coins: user.coins, ownedItems: user.ownedItems });
    return;
  }

  if (user.coins < itemCost) {
    res.status(402).json({ error: `Yetersiz altın! Gerekli: ${itemCost}, Sahip: ${user.coins}` });
    return;
  }

  user.coins -= itemCost;
  user.ownedItems.push(itemId);
  saveUser(user);

  res.json({ ok: true, newCoins: user.coins, ownedItems: user.ownedItems });
});

router.put("/shop/equip", (req, res) => {
  const token = extractToken(req);
  if (!token) { res.status(401).json({ error: "Token gerekli" }); return; }
  const payload = verifyToken(token);
  if (!payload) { res.status(401).json({ error: "Geçersiz token" }); return; }

  const user = findUserById(payload.id);
  if (!user) { res.status(404).json({ error: "Kullanıcı bulunamadı" }); return; }

  const { category, itemId } = req.body as { category: string; itemId: string };
  if (!category) { res.status(400).json({ error: "category gerekli" }); return; }

  user.equippedItems[category] = itemId;
  saveUser(user);

  res.json({ ok: true, equippedItems: user.equippedItems });
});

router.post("/shop/sync", (req, res) => {
  const token = extractToken(req);
  if (!token) { res.status(401).json({ error: "Token gerekli" }); return; }
  const payload = verifyToken(token);
  if (!payload) { res.status(401).json({ error: "Geçersiz token" }); return; }

  const user = findUserById(payload.id);
  if (!user) { res.status(404).json({ error: "Kullanıcı bulunamadı" }); return; }

  const { ownedItems, equippedItems } = req.body as {
    ownedItems?: string[];
    equippedItems?: Record<string, string>;
    coins?: number;
  };

  if (Array.isArray(ownedItems)) {
    const merged = new Set([...user.ownedItems, ...ownedItems]);
    user.ownedItems = [...merged];
  }
  if (equippedItems && typeof equippedItems === "object") {
    user.equippedItems = { ...user.equippedItems, ...equippedItems };
  }
  saveUser(user);

  res.json({ ok: true, ownedItems: user.ownedItems, equippedItems: user.equippedItems, coins: user.coins });
});

export default router;
