import { Server as IOServer, Socket } from "socket.io";
import { createServer, Server as HttpServer } from "http";
import { logger } from "./lib/logger.js";
import { verifyToken } from "./lib/auth.js";
import type { Express } from "express";

// ── Seeded PRNG (mulberry32) — identical to client ────────────────────────
function makeMulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── World constants — identical to client ─────────────────────────────────
const WORLD       = 7200;
const BIOME_EDGE  = 0.34;
const PLAY_RADIUS = WORLD * 0.90;
const RES_COUNT   = 420;

function getBiome(x: number, y: number): string {
  const nx = x / WORLD, ny = y / WORLD;
  if (Math.abs(nx) < BIOME_EDGE && Math.abs(ny) < BIOME_EDGE) return "forest";
  if (Math.abs(ny) >= Math.abs(nx)) return ny < 0 ? "snow" : "swamp";
  return nx > 0 ? "desert" : "darkforest";
}

// ── Resource defs — keep in sync with client RES_DEFS_BY_BIOME ────────────
const RES_DEFS: Record<string, Array<{
  type: string; w: number; radius: number; hp: number;
  yW: number; yS: number; yG: number; yA: number;
  yHp?: number; yXp?: number; ySpd?: number;
}>> = {
  forest: [
    { type:"wood",     w:30, radius:122, hp:800,  yW:6,  yS:0, yG:0, yA:0.25 },
    { type:"wood",     w:16, radius:152, hp:1100, yW:10, yS:0, yG:0, yA:0.18 },
    { type:"stone",    w:20, radius:96,  hp:950,  yW:0,  yS:6,  yG:0, yA:0 },
    { type:"stone",    w:10, radius:120, hp:1400, yW:0,  yS:10, yG:0, yA:0 },
    { type:"gold",     w:5,  radius:92,  hp:750,  yW:0,  yS:2,  yG:5, yA:0 },
    { type:"gold",     w:3,  radius:112, hp:1050, yW:0,  yS:3,  yG:9, yA:0 },
    { type:"apple",    w:10, radius:106, hp:650,  yW:4,  yS:0,  yG:0, yA:0.9 },
    { type:"bush",     w:14, radius:66,  hp:400,  yW:2,  yS:0,  yG:0, yA:0.5 },
    { type:"mushroom", w:8,  radius:52,  hp:250,  yW:0,  yS:0,  yG:1, yA:0, yHp:25 },
    { type:"crystal",  w:4,  radius:68,  hp:420,  yW:0,  yS:0,  yG:0, yA:0, yXp:30 },
    { type:"hive",     w:3,  radius:60,  hp:380,  yW:0,  yS:0,  yG:3, yA:0, ySpd:180 },
  ],
  snow: [
    { type:"wood",  w:25, radius:116, hp:720,  yW:5,  yS:0, yG:0, yA:0.12 },
    { type:"wood",  w:12, radius:144, hp:1000, yW:8,  yS:0, yG:0, yA:0.08 },
    { type:"stone", w:22, radius:98,  hp:1100, yW:0,  yS:7,  yG:0, yA:0 },
    { type:"stone", w:10, radius:122, hp:1600, yW:0,  yS:12, yG:0, yA:0 },
    { type:"gold",  w:6,  radius:94,  hp:800,  yW:0,  yS:2,  yG:6, yA:0 },
    { type:"gold",  w:3,  radius:114, hp:1100, yW:0,  yS:3,  yG:10, yA:0 },
    { type:"bush",  w:8,  radius:62,  hp:360,  yW:1,  yS:0,  yG:0, yA:0.3 },
  ],
  desert: [
    { type:"wood",  w:15, radius:112, hp:680,  yW:4,  yS:0, yG:0, yA:0.08 },
    { type:"wood",  w:8,  radius:138, hp:950,  yW:7,  yS:0, yG:0, yA:0.05 },
    { type:"stone", w:28, radius:100, hp:1050, yW:0,  yS:7,  yG:0, yA:0 },
    { type:"stone", w:14, radius:124, hp:1500, yW:0,  yS:12, yG:0, yA:0 },
    { type:"gold",  w:8,  radius:98,  hp:780,  yW:0,  yS:2,  yG:7, yA:0 },
    { type:"gold",  w:4,  radius:116, hp:1080, yW:0,  yS:3,  yG:11, yA:0 },
    { type:"bush",  w:10, radius:60,  hp:320,  yW:1,  yS:0,  yG:0, yA:0.2 },
  ],
  swamp: [
    { type:"wood",  w:22, radius:120, hp:760,  yW:5,  yS:0, yG:0, yA:0.15 },
    { type:"wood",  w:12, radius:148, hp:1080, yW:9,  yS:0, yG:0, yA:0.1 },
    { type:"stone", w:18, radius:94,  hp:880,  yW:0,  yS:5,  yG:0, yA:0 },
    { type:"stone", w:9,  radius:118, hp:1320, yW:0,  yS:9,  yG:0, yA:0 },
    { type:"gold",  w:7,  radius:92,  hp:720,  yW:0,  yS:2,  yG:6, yA:0 },
    { type:"gold",  w:4,  radius:112, hp:1020, yW:0,  yS:3,  yG:10, yA:0 },
    { type:"bush",  w:18, radius:70,  hp:440,  yW:2,  yS:0,  yG:0, yA:0.6 },
  ],
  darkforest: [
    { type:"wood",  w:28, radius:128, hp:880,  yW:7,  yS:0, yG:0, yA:0.1 },
    { type:"wood",  w:14, radius:156, hp:1240, yW:12, yS:0, yG:0, yA:0.07 },
    { type:"stone", w:20, radius:98,  hp:1200, yW:0,  yS:8,  yG:0, yA:0 },
    { type:"stone", w:10, radius:122, hp:1680, yW:0,  yS:13, yG:0, yA:0 },
    { type:"gold",  w:6,  radius:94,  hp:800,  yW:0,  yS:3,  yG:7, yA:0 },
    { type:"gold",  w:3,  radius:114, hp:1160, yW:0,  yS:4,  yG:12, yA:0 },
    { type:"bush",  w:12, radius:68,  hp:384,  yW:2,  yS:0,  yG:0, yA:0.4 },
  ],
};

interface WorldResource {
  x: number; y: number; radius: number; type: string;
  maxHp: number; hp: number;
  yW: number; yS: number; yG: number; yA: number;
  yHp: number; yXp: number; ySpd: number;
}

// ── Generate world with seed ───────────────────────────────────────────────
const WORLD_SEED = 0x4F52_4553;
const _worldRng  = makeMulberry32(WORLD_SEED);

function pickResDef(biome: string, rng: () => number) {
  const defs = RES_DEFS[biome] || RES_DEFS.forest;
  const total = defs.reduce((s, d) => s + d.w, 0);
  let r = rng() * total;
  for (const d of defs) { r -= d.w; if (r <= 0) return d; }
  return defs[0];
}

const worldResources: WorldResource[] = [];
(function generateResources() {
  const r = PLAY_RADIUS * 0.98;
  for (let i = 0; i < RES_COUNT; i++) {
    const x = (_worldRng() * 2 - 1) * r;
    const y = (_worldRng() * 2 - 1) * r;
    const biome = getBiome(x, y);
    const d = pickResDef(biome, _worldRng);
    const scaledHp = d.hp * 20;
    worldResources.push({
      x, y, radius: d.radius, type: d.type,
      maxHp: scaledHp, hp: scaledHp,
      yW: d.yW, yS: d.yS, yG: d.yG, yA: d.yA,
      yHp: d.yHp || 0, yXp: d.yXp || 0, ySpd: d.ySpd || 0,
    });
  }
})();

// ── OPTIMIZATION: Resource spatial grid ────────────────────────────────────
// Replaces 60-mob × 420-resource = 25,200 checks/tick with ~6-18 checks/mob
const RES_GRID_CELL = 300;
const RES_GRID_ORIGIN = WORLD / 2; // 3600
const RES_GRID_COLS = Math.ceil(WORLD / RES_GRID_CELL) + 2;

function resGridKey(cx: number, cy: number): number {
  return cy * RES_GRID_COLS + cx;
}

const resourceGrid = new Map<number, number[]>();
function buildResourceGrid() {
  resourceGrid.clear();
  worldResources.forEach((res, idx) => {
    const cx = Math.floor((res.x + RES_GRID_ORIGIN) / RES_GRID_CELL);
    const cy = Math.floor((res.y + RES_GRID_ORIGIN) / RES_GRID_CELL);
    const key = resGridKey(cx, cy);
    let cell = resourceGrid.get(key);
    if (!cell) { cell = []; resourceGrid.set(key, cell); }
    cell.push(idx);
  });
}
buildResourceGrid();

function getNearbyResIndices(x: number, y: number, checkRadius: number): number[] {
  const result: number[] = [];
  const cr = Math.ceil(checkRadius / RES_GRID_CELL) + 1;
  const cx0 = Math.floor((x + RES_GRID_ORIGIN) / RES_GRID_CELL);
  const cy0 = Math.floor((y + RES_GRID_ORIGIN) / RES_GRID_CELL);
  for (let dy = -cr; dy <= cr; dy++) {
    for (let dx = -cr; dx <= cr; dx++) {
      const cell = resourceGrid.get(resGridKey(cx0 + dx, cy0 + dy));
      if (cell) for (const idx of cell) result.push(idx);
    }
  }
  return result;
}

const resRespawnAt = new Map<number, number>();

// ── Player types ───────────────────────────────────────────────────────────
interface PlayerAcc { a?: string; y?: string; s?: string; k?: string; }

interface PlayerState {
  id: string; name: string; skin: string; color: string;
  x: number; y: number; angle: number; vx: number; vy: number;
  hp: number; maxHp: number; weapon: number; isAttacking: boolean;
  kills: number; xp: number; gold: number; axeTier: number; swordTier: number;
  mode: string; team: string; lastSwing: number; rankId: number;
  dead: boolean;
  score?: number;
  buildX?: number | null;
  buildY?: number | null;
  acc?: PlayerAcc;
}

interface Building {
  id: string; ownerId: string; type: number;
  x: number; y: number; angle: number; hp: number; maxHp: number; radius: number;
  tier?: number;
}

// ── Server-authoritative mob types ─────────────────────────────────────────
interface MobTypeDef {
  typeName: string; biomes: string[];
  shape: string; color: string; outline: string; eyes: string;
  radius: number; hp: number; dmg: number; speed: number;
  xpReward: number; goldReward: number; aggroRange: number;
  weight: number;
}

const MOB_TYPE_DEFS: MobTypeDef[] = [
  { typeName:'Yaban Domuzu',   biomes:['forest'],              shape:'boar',    color:'#8B6914', outline:'#5a3c0a', eyes:'#ff4444', radius:30, hp:140, dmg:28, speed:1.7, xpReward:25, goldReward:5,  aggroRange:260, weight:28 },
  { typeName:'Kurt',           biomes:['forest','snow'],        shape:'wolf',    color:'#888888', outline:'#444444', eyes:'#ffdd00', radius:27, hp:110, dmg:32, speed:2.3, xpReward:22, goldReward:4,  aggroRange:340, weight:24 },
  { typeName:'Ayı',            biomes:['forest'],               shape:'bear',    color:'#6B4423', outline:'#3a2512', eyes:'#ff3333', radius:40, hp:320, dmg:48, speed:1.2, xpReward:50, goldReward:12, aggroRange:210, weight:10 },
  { typeName:'Tilki',          biomes:['forest','darkforest'],  shape:'fox',     color:'#E06020', outline:'#8B3800', eyes:'#22aaff', radius:23, hp:80,  dmg:22, speed:2.7, xpReward:18, goldReward:3,  aggroRange:290, weight:18 },
  { typeName:'Kar Kurdu',      biomes:['snow'],                 shape:'wolf',    color:'#d4eeff', outline:'#6688bb', eyes:'#88ccff', radius:32, hp:155, dmg:34, speed:2.1, xpReward:32, goldReward:7,  aggroRange:310, weight:22 },
  { typeName:'Buz Trolü',      biomes:['snow'],                 shape:'golem',   color:'#7ab8e8', outline:'#3a6088', eyes:'#00ffff', radius:40, hp:300, dmg:52, speed:1.0, xpReward:45, goldReward:10, aggroRange:190, weight:8  },
  { typeName:'Penguen',        biomes:['snow'],                 shape:'penguin', color:'#222244', outline:'#000022', eyes:'#44aaff', radius:22, hp:60,  dmg:16, speed:1.4, xpReward:14, goldReward:3,  aggroRange:190, weight:18 },
  { typeName:'Akrep',          biomes:['desert'],               shape:'scorpion',color:'#c8a855', outline:'#7a5a10', eyes:'#ff2200', radius:28, hp:125, dmg:38, speed:1.9, xpReward:28, goldReward:6,  aggroRange:270, weight:22 },
  { typeName:'Kaya Yılanı',    biomes:['desert'],               shape:'snake',   color:'#b8824a', outline:'#7a4a18', eyes:'#ff6600', radius:22, hp:90,  dmg:25, speed:2.5, xpReward:20, goldReward:4,  aggroRange:310, weight:20 },
  { typeName:'Kum Yengeci',    biomes:['desert'],               shape:'crab',    color:'#d4a44c', outline:'#8a6420', eyes:'#ff3300', radius:28, hp:160, dmg:30, speed:1.5, xpReward:34, goldReward:7,  aggroRange:230, weight:14 },
  { typeName:'Bataklık Ejderi',biomes:['swamp'],                shape:'croc',    color:'#3a6a28', outline:'#162808', eyes:'#88ff44', radius:36, hp:240, dmg:45, speed:1.3, xpReward:40, goldReward:9,  aggroRange:280, weight:18 },
  { typeName:'Zehirli Örümcek',biomes:['swamp'],                shape:'spider',  color:'#3a2a4a', outline:'#1a0a2a', eyes:'#aa44ff', radius:24, hp:100, dmg:28, speed:2.1, xpReward:24, goldReward:5,  aggroRange:280, weight:18 },
  { typeName:'Karanlık Kurt',  biomes:['darkforest'],           shape:'wolf',    color:'#222233', outline:'#111122', eyes:'#ff00ff', radius:30, hp:180, dmg:42, speed:2.4, xpReward:36, goldReward:8,  aggroRange:370, weight:18 },
  { typeName:'Gölge Hayaleti', biomes:['darkforest'],           shape:'ghost',   color:'#334455', outline:'#1a2233', eyes:'#00ffff', radius:32, hp:140, dmg:35, speed:1.7, xpReward:30, goldReward:6,  aggroRange:330, weight:16 },
  { typeName:'Yarasa',         biomes:['forest','snow','desert','swamp','darkforest'], shape:'bat', color:'#332244', outline:'#1a1122', eyes:'#ff2244', radius:20, hp:65, dmg:20, speed:2.9, xpReward:16, goldReward:3, aggroRange:350, weight:14 },
];

interface ServerMob {
  id: string;
  typeIndex: number;
  x: number; y: number; vx: number; vy: number;
  hp: number; maxHp: number;
  radius: number; color: string; outline: string; shape: string; eyes: string;
  typeName: string; dmg: number; speed: number;
  xpReward: number; goldReward: number;
  aggroRange: number; provoked: boolean;
  lastPlayerDmg: number;
  hitFlash: number;
  angle: number;
  wanderAngle: number;
  leashX: number; leashY: number;
  _wanderTargetX?: number; _wanderTargetY?: number;
  // OPTIMIZATION: track prev state to skip unchanged mob emits
  _prevX: number; _prevY: number; _prevHp: number; _prevHitFlash: number;
}

// ── Party System ───────────────────────────────────────────────────────────
interface Party {
  code: string;
  leader: string;
  members: Set<string>;
  memberNames: Map<string, string>;
  createdAt: number;
}

const parties       = new Map<string, Party>();
const socketToParty = new Map<string, string>();

const MAX_BUILDINGS_PER_PLAYER = 60;
const MAX_PARTY_SIZE = 8;
const STATE_RATE_LIMIT_MS = 33; // max 30 state updates/sec per client
const stateLastAt = new Map<string, number>();

function partyMemberList(party: Party) {
  return [...party.members].map(id => ({
    id,
    name: party.memberNames.get(id) || "Savaşçı",
    isLeader: id === party.leader,
  }));
}

function leaveParty(socket: Socket, io: IOServer) {
  const code = socketToParty.get(socket.id);
  if (!code) return;
  const party = parties.get(code);
  socketToParty.delete(socket.id);
  socket.leave("party:" + code);
  if (!party) return;
  party.members.delete(socket.id);
  party.memberNames.delete(socket.id);
  if (party.members.size === 0) { parties.delete(code); return; }
  if (party.leader === socket.id) party.leader = [...party.members][0];
  io.to("party:" + code).emit("party_update", { code, members: partyMemberList(party) });
}

const players   = new Map<string, PlayerState>();
const buildings = new Map<string, Building>();

function cleanupPlayerBuildings(socketId: string, io: import("socket.io").Server): void {
  const destroyed: string[] = [];
  for (const [bid, b] of buildings) {
    if (b.ownerId === socketId) { buildings.delete(bid); destroyed.push(bid); }
  }
  for (const bid of destroyed) io.emit("build_destroy", { id: bid });
}

// Rate limiting maps
const spikeHitCooldowns = new Map<string, Map<string, number>>();
const arrowHitCooldowns = new Map<string, Map<string, number>>();
const trapCaught        = new Map<string, string>();

const PLAYER_RADIUS     = 34;
const SWING_COOLDOWN_MS = 400;

// ── Server mob state ─────────────────────────────────────────────────────────
const serverMobs: ServerMob[] = [];
// OPTIMIZATION: O(1) mob lookup by id instead of O(n) find()
const mobMap = new Map<string, ServerMob>();
let _mobIdCounter = 1;

function _genMobId() { return "m" + (_mobIdCounter++); }

function _pickBiomePos(): { x: number; y: number } {
  const bound = PLAY_RADIUS * 0.92;
  return {
    x: (Math.random() * 2 - 1) * bound,
    y: (Math.random() * 2 - 1) * bound,
  };
}

function _spawnMob() {
  const alivePlayers = [...players.values()].filter(p => !p.dead);
  let cx = 0, cy = 0;
  if (alivePlayers.length > 0) {
    const ref = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
    const ang = Math.random() * Math.PI * 2;
    const d = 700 + Math.random() * 700;
    const bound = PLAY_RADIUS - 260;
    cx = Math.max(-bound, Math.min(bound, ref.x + Math.cos(ang) * d));
    cy = Math.max(-bound, Math.min(bound, ref.y + Math.sin(ang) * d));
  } else {
    const p = _pickBiomePos(); cx = p.x; cy = p.y;
  }
  const biome = getBiome(cx, cy);
  const eligible = MOB_TYPE_DEFS.filter(t => t.biomes.includes(biome) || t.biomes.includes('any'));
  const pool = eligible.length ? eligible : MOB_TYPE_DEFS;
  const totalW = pool.reduce((s, t) => s + t.weight, 0);
  let r = Math.random() * totalW;
  let typeIdx = 0;
  for (let i = 0; i < pool.length; i++) { r -= pool[i].weight; if (r <= 0) { typeIdx = MOB_TYPE_DEFS.indexOf(pool[i]); break; } }
  const td = MOB_TYPE_DEFS[typeIdx];
  const mob: ServerMob = {
    id: _genMobId(),
    typeIndex: typeIdx,
    x: cx, y: cy, vx: 0, vy: 0,
    hp: td.hp, maxHp: td.hp,
    radius: td.radius, color: td.color, outline: td.outline,
    shape: td.shape, eyes: td.eyes,
    typeName: td.typeName, dmg: td.dmg, speed: td.speed,
    xpReward: td.xpReward, goldReward: td.goldReward,
    aggroRange: td.aggroRange, provoked: false,
    lastPlayerDmg: 0, hitFlash: 0, angle: 0,
    wanderAngle: Math.random() * Math.PI * 2,
    leashX: cx, leashY: cy,
    _prevX: cx, _prevY: cy, _prevHp: td.hp, _prevHitFlash: 0,
  };
  serverMobs.push(mob);
  mobMap.set(mob.id, mob);
}

function dist2(ax: number, ay: number, bx: number, by: number) {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}

function inArc(ax: number, ay: number, aAngle: number, bx: number, by: number,
               hitRange: number, halfArc: number): boolean {
  const dx = bx - ax, dy = by - ay;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d > hitRange) return false;
  const angle = Math.atan2(dy, dx);
  let diff = angle - aAngle;
  while (diff >  Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return Math.abs(diff) <= halfArc;
}

// ── OPTIMIZATION: Batched resource sync ───────────────────────────────────
// Instead of io.emit("res_sync") on every hit, collect and flush every 100ms
const pendingResSyncs = new Map<number, { hp: number; shake: number }>();

export function createGameServer(app: Express): HttpServer {
  const httpServer = createServer(app);

  const io = new IOServer(httpServer, {
    path: "/api/socket.io",
    cors: { origin: "*" },
    transports: ["websocket"],
    pingInterval: 5000,
    pingTimeout: 10000,
    perMessageDeflate: false,
    httpCompression: false,
  });

  const broadcastOnlineCount = () => io.emit("online_count", io.sockets.sockets.size);

  // ── Flush batched res_sync every 100ms ──────────────────────────────────
  setInterval(() => {
    if (pendingResSyncs.size === 0) return;
    for (const [idx, data] of pendingResSyncs) {
      io.emit("res_sync", { idx, hp: data.hp, shake: data.shake });
    }
    pendingResSyncs.clear();
  }, 100);

  // ── Resource respawn ticker ─────────────────────────────────────────────
  setInterval(() => {
    const now = Date.now();
    for (const [idx, at] of resRespawnAt) {
      if (now >= at) {
        resRespawnAt.delete(idx);
        worldResources[idx].hp = worldResources[idx].maxHp;
        io.emit("res_respawn", { idx });
      }
    }
  }, 1000);

  // ── Live leaderboard broadcast every 3 seconds ──────────────────────────
  setInterval(() => {
    if (players.size === 0) return;
    const entries = Array.from(players.values())
      .filter(p => !p.dead)
      .map(p => ({ name: p.name, score: p.score || 0, kills: p.kills }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    io.emit("live_lb", entries);
  }, 3000);

  // ── Stale party cleanup (every 30 min) ─────────────────────────────────
  setInterval(() => {
    const now = Date.now();
    for (const [code, party] of parties) {
      if (now - party.createdAt > 30 * 60 * 1000 && party.members.size === 0) {
        parties.delete(code);
      }
    }
  }, 60_000);

  // ── Arrow hit cooldown GC — prune entries older than 10 seconds ──────────
  // Prevents unbounded growth when players shoot many arrows over a session.
  setInterval(() => {
    const cutoff = Date.now() - 10_000;
    for (const [, cooldownMap] of arrowHitCooldowns) {
      for (const [key, ts] of cooldownMap) {
        if (ts < cutoff) cooldownMap.delete(key);
      }
    }
    // Also clean up spike cooldown entries for players who have left
    for (const [ownerId, cooldownMap] of spikeHitCooldowns) {
      if (!players.has(ownerId)) {
        spikeHitCooldowns.delete(ownerId);
        continue;
      }
      for (const [victimId, ts] of cooldownMap) {
        if (!players.has(victimId) || Date.now() - ts > 10_000) {
          cooldownMap.delete(victimId);
        }
      }
    }
  }, 15_000);

  io.on("connection", (socket: Socket) => {
    logger.info({ id: socket.id }, "Player connected");
    socket.emit("online_count", io.sockets.sockets.size);
    broadcastOnlineCount();

    // ── join ────────────────────────────────────────────────────────────
    socket.on("join", (data: {
      name?: string; skin?: string; color?: string;
      x?: number; y?: number; mode?: string; team?: string; token?: string;
      partyCode?: string; acc?: PlayerAcc;
    }) => {
      if (!data || typeof data !== "object") return;
      // Prevent duplicate join — if already in players map, ignore
      if (players.has(socket.id)) return;
      let rankId = 0;
      if (data.token) {
        const payload = verifyToken(data.token);
        if (payload) rankId = payload.rankId ?? 0;
      }

      let team = data.team || "";
      if (data.partyCode) {
        const pCode = data.partyCode.toUpperCase();
        if (parties.has(pCode)) team = pCode;
      }

      const player: PlayerState = {
        id: socket.id,
        name: (data.name || "Savaşçı").slice(0, 24),
        skin: data.skin || "warrior",
        color: data.color || "#8B5E3A",
        x: data.x ?? 0, y: data.y ?? 0,
        angle: 0, vx: 0, vy: 0,
        hp: 200, maxHp: 200, weapon: 1, isAttacking: false,
        kills: 0, xp: 0, gold: 0, axeTier: 0, swordTier: 0,
        mode: data.mode || "classic", team,
        lastSwing: 0, rankId, dead: false,
        acc: (data.acc && typeof data.acc === 'object') ? data.acc as PlayerAcc : {},
      };
      players.set(socket.id, player);

      const othersObj: Record<string, object> = {};
      players.forEach((p, id) => {
        if (id !== socket.id && !p.dead) {
          othersObj[id] = {
            n: p.name, sk: p.skin, x: p.x, y: p.y, a: p.angle,
            vx: p.vx, vy: p.vy, hp: p.hp, mhp: p.maxHp,
            w: p.weapon, atk: p.isAttacking, k: p.kills, xp: p.xp,
            at: p.axeTier, st: p.swordTier, color: p.color, rk: p.rankId,
            team: p.team, acc: p.acc || {},
          };
        }
      });

      const buildingsObj: Record<string, object> = {};
      buildings.forEach((b, id) => { buildingsObj[id] = { ...b }; });

      const resHp: Record<number, number> = {};
      worldResources.forEach((r, i) => { if (r.hp < r.maxHp) resHp[i] = r.hp; });

      const mobsSnapshot = serverMobs.map(m => ({
        id: m.id, x: m.x, y: m.y, vx: m.vx, vy: m.vy,
        hp: m.hp, maxHp: m.maxHp, radius: m.radius,
        color: m.color, outline: m.outline, shape: m.shape,
        eyes: m.eyes, hitFlash: 0, typeName: m.typeName,
        dmg: m.dmg, xpReward: m.xpReward, goldReward: m.goldReward, angle: m.angle,
      }));

      socket.emit("welcome", {
        id: socket.id,
        players: othersObj,
        buildings: buildingsObj,
        worldSeed: WORLD_SEED,
        resHp,
        mobs: mobsSnapshot,
        team,
      });

      socket.broadcast.emit("player_join", {
        id: socket.id,
        state: {
          name: player.name, skin: player.skin, x: player.x, y: player.y,
          angle: player.angle, hp: player.hp, maxHp: player.maxHp,
          weapon: player.weapon, isAttacking: false, kills: 0, xp: 0,
          axeTier: 0, swordTier: 0, color: player.color, rankId: player.rankId,
          team, acc: player.acc || {},
        },
      });

      broadcastOnlineCount();
      logger.info({ name: player.name, rankId, team, total: players.size }, "Player joined");
    });

    // ── state ────────────────────────────────────────────────────────────
    socket.on("state", (s: {
      x?: number; y?: number; angle?: number; vx?: number; vy?: number;
      hp?: number; maxHp?: number; weapon?: number; isAttacking?: boolean;
      kills?: number; xp?: number; axeTier?: number; swordTier?: number;
      buildX?: number | null; buildY?: number | null;
    }) => {
      if (!s || typeof s !== "object") return;
      const player = players.get(socket.id);
      if (!player || player.dead) return;

      // Rate-limit: ignore excess state floods (>30 updates/sec)
      const nowS = Date.now();
      if (nowS - (stateLastAt.get(socket.id) ?? 0) < STATE_RATE_LIMIT_MS) return;
      stateLastAt.set(socket.id, nowS);

      const WORLD_LIMIT = 7200 * 0.96; // slightly beyond PLAY_RADIUS, catches blatant teleports
      if (typeof s.x === "number" && isFinite(s.x))  player.x = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, s.x));
      if (typeof s.y === "number" && isFinite(s.y))  player.y = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, s.y));
      if (typeof s.angle === "number" && isFinite(s.angle)) player.angle = s.angle;
      if (typeof s.vx === "number" && isFinite(s.vx)) player.vx = s.vx;
      if (typeof s.vy === "number" && isFinite(s.vy)) player.vy = s.vy;
      if (typeof s.hp === "number")           player.hp = Math.max(0, Math.min(player.maxHp, s.hp));
      if (typeof s.maxHp === "number")        player.maxHp = Math.min(2000, Math.max(1, s.maxHp));
      if (typeof s.weapon === "number")       player.weapon = s.weapon;
      if (typeof s.isAttacking === "boolean") player.isAttacking = s.isAttacking;
      if (typeof s.kills === "number")        player.kills = Math.max(0, s.kills);
      if (typeof s.xp === "number")           player.xp = Math.max(0, s.xp);
      const _sg = (s as Record<string, unknown>);
      if (typeof _sg.gold === "number")       player.gold  = Math.max(0, _sg.gold as number);
      if (typeof _sg.sc   === "number")       player.score = Math.max(0, _sg.sc   as number);
      if (typeof s.axeTier   === "number")    player.axeTier   = Math.min(6, Math.max(0, s.axeTier));
      if (typeof s.swordTier === "number")    player.swordTier = Math.min(6, Math.max(0, s.swordTier));
      player.buildX = (typeof s.buildX === "number" && isFinite(s.buildX)) ? s.buildX : null;
      player.buildY = (typeof s.buildY === "number" && isFinite(s.buildY)) ? s.buildY : null;
      const _sacc = _sg.acc;
      if (_sacc && typeof _sacc === 'object') player.acc = _sacc as PlayerAcc;
    });

    // ── swing (PvP) ──────────────────────────────────────────────────────
    // Client sends x,y for lag compensation. We trust it if within 200px of
    // last known position (prevents trivial position spoofing).
    socket.on("swing", (data: {
      angle: number; weapon: number; axeTier?: number; swordTier?: number;
      x?: number; y?: number;
    }) => {
      if (!data || typeof data !== "object") return;
      const attacker = players.get(socket.id);
      if (!attacker || attacker.dead) return;

      const now = Date.now();
      if (now - attacker.lastSwing < SWING_COOLDOWN_MS) return;
      attacker.lastSwing = now;

      const angle  = typeof data.angle  === "number" ? data.angle  : attacker.angle;
      const weapon = typeof data.weapon === "number" ? data.weapon : attacker.weapon;

      // Use client-supplied attacker position if it's close enough to last known
      // (anti-cheat: max 200px teleport between ticks)
      let ax = attacker.x, ay = attacker.y;
      if (typeof data.x === "number" && typeof data.y === "number") {
        const drift = Math.sqrt(dist2(data.x, data.y, attacker.x, attacker.y));
        if (drift < 200) { ax = data.x; ay = data.y; }
      }

      let hitRange = 110;
      let dmgBase  = 25;
      let halfArc  = Math.PI / 3;

      if (weapon === 2) { hitRange = 130; dmgBase = 18; halfArc = Math.PI / 2.5; }
      else if (weapon === 3) { hitRange = 90; dmgBase = 45; halfArc = Math.PI / 5; }

      // Add lag tolerance buffer so position staleness doesn't cause ghost misses
      const lagBuffer = 45;

      const axeTier   = Math.min(6, Math.max(0, data.axeTier   ?? attacker.axeTier));
      const swordTier = Math.min(6, Math.max(0, data.swordTier ?? attacker.swordTier));
      if (weapon === 2) dmgBase += axeTier   * 8;
      else              dmgBase += swordTier * 10;

      players.forEach((target, tid) => {
        if (tid === socket.id || target.dead) return;
        if (attacker.team && target.team && attacker.team === target.team) return;

        // Lag compensation: predict where the target was when the swing was sent.
        // vx/vy are px/frame at 60fps. Assume ~80ms = ~5 frame lag.
        const LAG_FRAMES = 5;
        const predX = target.x + (target.vx || 0) * LAG_FRAMES;
        const predY = target.y + (target.vy || 0) * LAG_FRAMES;

        const effectiveRange = hitRange + PLAYER_RADIUS + lagBuffer;
        const hitCurrent   = inArc(ax, ay, angle, target.x, target.y, effectiveRange, halfArc);
        const hitPredicted = inArc(ax, ay, angle, predX,    predY,    effectiveRange, halfArc);
        if (!hitCurrent && !hitPredicted) return;

        target.hp = Math.max(0, target.hp - dmgBase);
        io.to(tid).emit("pvp_hit", { dmg: dmgBase, fromName: attacker.name });
        socket.emit("pvp_confirm", { targetId: tid, dmg: dmgBase, targetName: target.name });

        if (target.hp <= 0 && !target.dead) {
          target.dead = true;
          attacker.kills++;
          cleanupPlayerBuildings(tid, io);
          socket.emit("pvp_kill_confirm", { targetName: target.name, targetId: tid });
          io.to(tid).emit("pvp_killed", { byName: attacker.name });
          io.emit("player_dead", { id: tid, killer: socket.id, killerName: attacker.name });
        }
      });
    });

    // ── res_hit (was "harvest" — renamed to match client) ────────────────
    socket.on("res_hit", (data: { idx: number; dmg: number }) => {
      if (!data || typeof data !== "object") return;
      const idx = Math.floor(data.idx);
      if (idx < 0 || idx >= worldResources.length) return;
      const res = worldResources[idx];
      if (res.hp <= 0) return;

      const player = players.get(socket.id);
      if (!player || player.dead) return;

      const dist = Math.sqrt(dist2(player.x, player.y, res.x, res.y));
      if (dist > res.radius + PLAYER_RADIUS + 80) return;

      const dmg = Math.min(200, Math.max(1, Math.floor(data.dmg)));
      res.hp = Math.max(0, res.hp - dmg);

      // OPTIMIZATION: batch res_sync, emit once per 100ms instead of per hit
      const existing = pendingResSyncs.get(idx);
      pendingResSyncs.set(idx, { hp: res.hp, shake: existing ? 0 : 1 });

      if (res.hp <= 0) {
        resRespawnAt.set(idx, Date.now() + 30_000);
      }
    });

    // ── place_building ───────────────────────────────────────────────────
    socket.on("place_building", (data: {
      id: string; type: number; x: number; y: number; angle: number;
      tier?: number; hp?: number; maxHp?: number; radius?: number;
    }) => {
      if (!data || typeof data !== "object") return;
      const player = players.get(socket.id);
      if (!player || player.dead) return;

      // Flood protection: count how many buildings this player already owns
      let playerBuildingCount = 0;
      for (const b of buildings.values()) {
        if (b.ownerId === socket.id) playerBuildingCount++;
      }
      if (playerBuildingCount >= MAX_BUILDINGS_PER_PLAYER) return;

      const bid = String(data.id).slice(0, 36);
      if (!bid) return;
      if (buildings.has(bid)) return;

      // Validate position — must be finite numbers within world bounds
      const WORLD_LIMIT = 7200 * 0.96;
      if (!isFinite(data.x) || !isFinite(data.y)) return;
      const bx = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, data.x));
      const by = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, data.y));

      const btype  = Math.floor(data.type);
      const maxHp  = Math.min(10000, Math.max(50,  Math.floor(data.maxHp  ?? 150)));
      const hp     = Math.min(maxHp,  Math.max(1,   Math.floor(data.hp    ?? maxHp)));
      const radius = Math.min(200,    Math.max(10,  Math.floor(data.radius ?? 50)));

      const building: Building = {
        id: bid, ownerId: socket.id, type: btype,
        x: bx, y: by, angle: data.angle ?? 0,
        hp, maxHp, radius,
        tier: Math.min(6, Math.max(0, Math.floor(data.tier ?? 0))),
      };
      buildings.set(bid, building);
      io.emit("build", { id: bid, building });
    });

    // ── build_destroy ────────────────────────────────────────────────────
    socket.on("build_destroy", (data: { id: string }) => {
      if (!data?.id) return;
      const bid = String(data.id).slice(0, 36);
      const building = buildings.get(bid);
      if (!building) return;
      if (building.ownerId !== socket.id) return;
      buildings.delete(bid);
      io.emit("build_destroy", { id: bid });
    });

    // ── building_hit ─────────────────────────────────────────────────────
    socket.on("building_hit", (data: { id: string; dmg: number }) => {
      if (!data || typeof data !== "object") return;
      const bid = String(data.id || "").slice(0, 36);
      if (!bid) return;
      const building = buildings.get(bid);
      if (!building) return;

      const attacker = players.get(socket.id);
      if (!attacker || attacker.dead) return;

      const dist = Math.sqrt(dist2(attacker.x, attacker.y, building.x, building.y));
      if (dist > building.radius + PLAYER_RADIUS + 120) return;

      const dmg = Math.min(200, Math.max(1, Math.floor(data.dmg)));
      building.hp = Math.max(0, building.hp - dmg);

      io.emit("build_hp_update", { id: bid, hp: building.hp });

      if (building.hp <= 0) {
        buildings.delete(bid);
        io.emit("build_destroy", { id: bid });
        // Collect victims first to avoid mutating map during iteration
        const freedVictims: string[] = [];
        for (const [victimId, bId] of trapCaught) {
          if (bId === bid) freedVictims.push(victimId);
        }
        for (const victimId of freedVictims) {
          trapCaught.delete(victimId);
          io.to(victimId).emit("trap_freed");
          io.to(building.ownerId).emit("trap_victim_freed", { victimId });
        }
      }
    });

    // ── build_hp_update (owner reports damage from local enemies) ────────
    socket.on("build_hp_update", (data: { id: string; hp: number }) => {
      if (!data?.id || typeof data.hp !== "number") return;
      const bid = String(data.id).slice(0, 36);
      const building = buildings.get(bid);
      if (!building || building.ownerId !== socket.id) return;
      building.hp = Math.min(building.maxHp, Math.max(0, Math.floor(data.hp)));
      socket.broadcast.emit("build_hp_update", { id: bid, hp: building.hp });
      if (building.hp <= 0) {
        buildings.delete(bid);
        io.emit("build_destroy", { id: bid });
        const freedVictims2: string[] = [];
        for (const [victimId, bId] of trapCaught) {
          if (bId === bid) freedVictims2.push(victimId);
        }
        for (const victimId of freedVictims2) {
          trapCaught.delete(victimId);
          io.to(victimId).emit("trap_freed");
          io.to(building.ownerId).emit("trap_victim_freed", { victimId });
        }
      }
    });

    // ── build_tier_update ────────────────────────────────────────────────
    socket.on("build_tier_update", (data: { id: string; tier: number; maxHp: number; hp: number }) => {
      if (!data || typeof data !== "object") return;
      const building = buildings.get(String(data.id).slice(0, 36));
      if (!building || building.ownerId !== socket.id) return;

      building.tier  = Math.min(6, Math.max(0, Math.floor(data.tier  ?? building.tier  ?? 0)));
      building.maxHp = Math.max(1, Math.floor(data.maxHp ?? building.maxHp));
      building.hp    = Math.min(building.maxHp, Math.max(0, Math.floor(data.hp ?? building.hp)));

      socket.broadcast.emit("build_tier_update", {
        id: building.id, tier: building.tier, maxHp: building.maxHp, hp: building.hp,
      });
    });

    // ── trap_touch ───────────────────────────────────────────────────────
    socket.on("trap_touch", (data: { victimId: string; buildingId: string }) => {
      if (!data || typeof data !== "object") return;
      const building = buildings.get(data.buildingId);
      if (!building || building.type !== 6) return;
      if (building.ownerId !== socket.id) return;

      const victim = players.get(data.victimId);
      if (!victim || victim.dead) return;
      if (trapCaught.has(data.victimId)) return;

      const dist = Math.sqrt(dist2(victim.x, victim.y, building.x, building.y));
      if (dist > building.radius + PLAYER_RADIUS + 20) return;

      trapCaught.set(data.victimId, data.buildingId);
      io.to(data.victimId).emit("trap_caught", { buildingId: data.buildingId });
    });

    // ── trap_owner_push — trap owner slowly pushes a trapped victim ───────
    // Rate-limited server-side to prevent spam. Victim's client receives
    // "trap_victim_push" and updates their local position.
    const _trapPushLastAt = new Map<string, number>();
    socket.on("trap_owner_push", (data: { victimId: string; dx: number; dy: number }) => {
      if (!data || typeof data !== "object") return;
      const victimId = String(data.victimId || "").slice(0, 36);
      if (!victimId) return;

      // Verify: this socket must be the trap owner holding the victim
      const bId = trapCaught.get(victimId);
      if (!bId) return;
      const trap = buildings.get(bId);
      if (!trap || trap.ownerId !== socket.id) return;

      const victim = players.get(victimId);
      if (!victim || victim.dead) return;

      // Rate-limit: max 1 push per 50ms per victim
      const now = Date.now();
      if (now - (_trapPushLastAt.get(victimId) ?? 0) < 50) return;
      _trapPushLastAt.set(victimId, now);

      // Clamp direction to unit vector, apply 2.5px nudge
      const rawDx = Number(data.dx) || 0;
      const rawDy = Number(data.dy) || 0;
      const mag = Math.sqrt(rawDx * rawDx + rawDy * rawDy) || 1;
      const nx = (rawDx / mag) * 2.5;
      const ny = (rawDy / mag) * 2.5;

      victim.x += nx;
      victim.y += ny;

      // Notify victim so their client position updates
      io.to(victimId).emit("trap_victim_push", { dx: nx, dy: ny });
    });

    // ── spike_hit (server-authoritative) ─────────────────────────────────
    // Client may send buildingId as "buildingId" or "bId" — accept both
    socket.on("spike_hit", (data: {
      victimId?: string; targetId?: string;
      buildingId?: string; bId?: string;
      dmg: number;
    }) => {
      if (!data || typeof data !== "object") return;
      const bid = data.buildingId || data.bId;
      const victimSocketId = data.victimId || data.targetId;
      if (!bid || !victimSocketId) return;

      const building = buildings.get(bid);
      if (!building || building.type !== 3) return;

      const victim = players.get(victimSocketId);
      if (!victim || victim.dead) return;

      const distV = Math.sqrt(dist2(victim.x, victim.y, building.x, building.y));
      // +70 lag buffer: victim's server position can be up to ~100ms stale
      if (distV > building.radius + PLAYER_RADIUS + 70) return;

      const SPIKE_COOLDOWN_MS = 500;
      let cooldownMap = spikeHitCooldowns.get(socket.id);
      if (!cooldownMap) { cooldownMap = new Map(); spikeHitCooldowns.set(socket.id, cooldownMap); }
      const now = Date.now();
      const last = cooldownMap.get(victimSocketId) ?? 0;
      if (now - last < SPIKE_COOLDOWN_MS) return;
      cooldownMap.set(victimSocketId, now);

      const dmg = Math.min(90, Math.max(1, Math.floor(data.dmg)));
      victim.hp = Math.max(0, victim.hp - dmg);
      const owner = players.get(building.ownerId);
      io.to(victimSocketId).emit("pvp_hit", { dmg, fromName: owner?.name || "Kazık" });
      if (owner) io.to(building.ownerId).emit("spike_dmg_confirm", { targetId: victimSocketId, dmg, targetName: victim.name });

      // Trapped players CANNOT be knocked back by spikes — they stay put and take DOT
      const isVictimTrapped = trapCaught.has(victimSocketId);
      if (!isVictimTrapped) {
        const pushDist = Math.sqrt(dist2(victim.x, victim.y, building.x, building.y)) || 1;
        const pushDx = (victim.x - building.x) / pushDist;
        const pushDy = (victim.y - building.y) / pushDist;
        io.to(victimSocketId).emit("spike_push", { dx: pushDx, dy: pushDy, force: 180 });
      }
      // If trapped: no knockback — victim stays in range and takes 0.5s DOT naturally

      if (victim.hp <= 0 && !victim.dead) {
        victim.dead = true;
        cleanupPlayerBuildings(victimSocketId, io);
        if (owner) { owner.kills++; io.to(building.ownerId).emit("pvp_kill_confirm", { targetName: victim.name, targetId: victimSocketId }); }
        io.to(victimSocketId).emit("pvp_killed", { byName: owner?.name || "Kazık" });
        io.emit("player_dead", { id: victimSocketId, killer: building.ownerId, killerName: owner?.name || "Kazık" });
      }
    });

    // ── arrow_hit ────────────────────────────────────────────────────────
    socket.on("arrow_hit", (data: {
      victimId: string; arrowId: string; dmg: number;
      ax: number; ay: number;
    }) => {
      if (!data || typeof data !== "object") return;
      const attacker = players.get(socket.id);
      if (!attacker || attacker.dead) return;
      const victim = players.get(data.victimId);
      if (!victim || victim.dead) return;
      if (attacker.team && victim.team && attacker.team === victim.team) return;

      const ARROW_COOLDOWN_MS = 100;
      const arrowKey = `${socket.id}:${data.arrowId}`;
      let cooldownMap = arrowHitCooldowns.get(socket.id);
      if (!cooldownMap) { cooldownMap = new Map(); arrowHitCooldowns.set(socket.id, cooldownMap); }
      const now = Date.now();
      const last = cooldownMap.get(arrowKey) ?? 0;
      if (now - last < ARROW_COOLDOWN_MS) return;
      cooldownMap.set(arrowKey, now);

      const dmg = Math.min(80, Math.max(1, Math.floor(data.dmg)));
      victim.hp = Math.max(0, victim.hp - dmg);
      io.to(data.victimId).emit("pvp_hit", { dmg, fromName: attacker.name });
      socket.emit("pvp_confirm", { targetId: data.victimId, dmg, targetName: victim.name });

      if (victim.hp <= 0 && !victim.dead) {
        victim.dead = true;
        attacker.kills++;
        cleanupPlayerBuildings(data.victimId, io);
        socket.emit("pvp_kill_confirm", { targetName: victim.name, targetId: data.victimId });
        io.to(data.victimId).emit("pvp_killed", { byName: attacker.name });
        io.emit("player_dead", { id: data.victimId, killer: socket.id, killerName: attacker.name });
      }
    });

    // ── mob_hit_req ──────────────────────────────────────────────────────
    // OPTIMIZATION: O(1) mob lookup via mobMap instead of O(n) array.find()
    socket.on("mob_hit_req", (data: { mobId: string; dmg: number }) => {
      if (!data || typeof data !== "object") return;
      const attacker = players.get(socket.id);
      if (!attacker || attacker.dead) return;

      const mobId = typeof data.mobId === "string" ? data.mobId.slice(0, 36) : "";
      if (!mobId) return;
      const mob = mobMap.get(mobId);
      if (!mob) return;

      const dist = Math.sqrt(dist2(attacker.x, attacker.y, mob.x, mob.y));
      if (dist > mob.radius + PLAYER_RADIUS + 150) return;

      const dmg = Math.min(300, Math.max(1, Math.floor(data.dmg)));
      mob.hp = Math.max(0, mob.hp - dmg);
      mob.provoked = true;
      mob.lastPlayerDmg = Date.now();
      mob.hitFlash = 6;

      io.emit("mob_update", {
        id: mob.id, x: mob.x, y: mob.y, vx: mob.vx, vy: mob.vy,
        hp: mob.hp, hitFlash: mob.hitFlash, angle: mob.angle,
      });

      if (mob.hp <= 0) {
        const idx = serverMobs.indexOf(mob);
        if (idx !== -1) serverMobs.splice(idx, 1);
        mobMap.delete(mob.id);
        io.emit("mob_dead", { id: mob.id });
        const score = Math.round(mob.xpReward * 2 + mob.goldReward * 10);
        io.to(socket.id).emit("mob_kill_reward", {
          xp: mob.xpReward, gold: mob.goldReward, score, typeName: mob.typeName,
        });
        socket.broadcast.emit("mob_killed_broadcast", {
          typeName: mob.typeName, killerName: players.get(socket.id)?.name || "Savaşçı",
        });
      }
    });

    // ── ping ─────────────────────────────────────────────────────────────
    socket.on("ping_req", (data: { t?: number }) => {
      socket.emit("pong_res", { t: data?.t ?? Date.now() });
    });

    // ── party system ─────────────────────────────────────────────────────
    socket.on("party_create", (data: { name?: string }) => {
      leaveParty(socket, io);
      // Generate a unique code — retry until no collision
      let code = Math.random().toString(36).slice(2, 8).toUpperCase();
      let tries = 0;
      while (parties.has(code) && tries++ < 10) {
        code = Math.random().toString(36).slice(2, 8).toUpperCase();
      }
      const party: Party = {
        code, leader: socket.id,
        members: new Set([socket.id]),
        memberNames: new Map([[socket.id, (data?.name || "Savaşçı").slice(0, 24)]]),
        createdAt: Date.now(),
      };
      parties.set(code, party);
      socketToParty.set(socket.id, code);
      socket.join("party:" + code);
      socket.emit("party_created", { code, members: partyMemberList(party) });
    });

    socket.on("party_join", (data: { code?: string; name?: string }) => {
      if (!data?.code) return;
      const code = data.code.toUpperCase().slice(0, 10);
      const party = parties.get(code);
      if (!party) { socket.emit("party_error", { msg: "Parti bulunamadı" }); return; }
      if (party.members.size >= MAX_PARTY_SIZE) {
        socket.emit("party_error", { msg: "Parti dolu (maks " + MAX_PARTY_SIZE + " oyuncu)" });
        return;
      }
      leaveParty(socket, io);
      party.members.add(socket.id);
      party.memberNames.set(socket.id, (data.name || "Savaşçı").slice(0, 24));
      socketToParty.set(socket.id, code);
      socket.join("party:" + code);
      const memberList = partyMemberList(party);
      io.to("party:" + code).emit("party_update", { code, members: memberList });
      socket.emit("party_joined", { code, members: memberList });
    });

    socket.on("party_leave", () => leaveParty(socket, io));

    socket.on("party_kick", (data: { targetId?: string }) => {
      const code = socketToParty.get(socket.id);
      if (!code) return;
      const party = parties.get(code);
      if (!party || party.leader !== socket.id || !data?.targetId) return;
      const target = data.targetId;
      if (!party.members.has(target)) return;
      party.members.delete(target);
      party.memberNames.delete(target);
      socketToParty.delete(target);
      io.to(target).emit("party_kicked");
      const targetSocket = io.sockets.sockets.get(target);
      targetSocket?.leave("party:" + code);
      const memberList = partyMemberList(party);
      io.to("party:" + code).emit("party_update", { code, members: memberList });
    });

    // ── respawn ──────────────────────────────────────────────────────────
    socket.on("respawn", (data: {
      name?: string; skin?: string; color?: string; x?: number; y?: number; token?: string; acc?: PlayerAcc;
    }) => {
      const player = players.get(socket.id);
      if (!player) return;

      let rankId = player.rankId;
      if (data?.token) {
        const payload = verifyToken(data.token);
        if (payload) rankId = payload.rankId ?? rankId;
      }

      player.dead = false;
      player.hp = 200; player.maxHp = 200;
      player.kills = 0; player.xp = 0; player.gold = 0;
      player.axeTier = 0; player.swordTier = 0;
      player.weapon = 1; player.isAttacking = false;
      player.x = data?.x ?? 0; player.y = data?.y ?? 0;
      player.vx = 0; player.vy = 0; player.angle = 0;
      player.name   = ((data?.name)  || player.name).slice(0, 24);
      player.skin   = data?.skin   || player.skin;
      player.color  = data?.color  || player.color;
      player.rankId = rankId;
      if (data?.acc && typeof data.acc === 'object') player.acc = data.acc as PlayerAcc;

      socket.broadcast.emit("player_respawn", {
        id: socket.id,
        state: {
          name: player.name, skin: player.skin, x: player.x, y: player.y,
          angle: 0, hp: 200, maxHp: 200, weapon: 1, isAttacking: false,
          kills: 0, xp: 0, axeTier: 0, swordTier: 0, color: player.color,
          rankId: player.rankId, team: player.team, acc: player.acc || {},
        },
      });
    });

    // ── disconnect ───────────────────────────────────────────────────────
    socket.on("disconnect", () => {
      const leavingPlayer = players.get(socket.id);
      const leavingName = leavingPlayer?.name;
      players.delete(socket.id);
      spikeHitCooldowns.delete(socket.id);
      arrowHitCooldowns.delete(socket.id);
      stateLastAt.delete(socket.id);

      // ── Clean up all buildings owned by the disconnecting player ─────
      cleanupPlayerBuildings(socket.id, io);

      // ── Free any trap victims — collect first, then delete ───────────
      trapCaught.delete(socket.id); // in case this player was caught in a trap
      const trapVictimsToFree: string[] = [];
      for (const [victimId, bId] of trapCaught) {
        const b = buildings.get(bId);
        if (!b || b.ownerId === socket.id) trapVictimsToFree.push(victimId);
      }
      for (const victimId of trapVictimsToFree) {
        trapCaught.delete(victimId);
        io.to(victimId).emit("trap_freed");
      }

      leaveParty(socket, io);
      socket.broadcast.emit("player_left", { id: socket.id, name: leavingName });
      broadcastOnlineCount();
      logger.info({ id: socket.id }, "Player disconnected");
    });
  });

  // ── Pre-spawn mobs immediately so world is populated when first player joins
  const MAX_MOBS     = 25;  // reduced from 60 — less lag, still enough density
  const MOB_TICK_MS  = 50;
  while (serverMobs.length < MAX_MOBS) _spawnMob();

  // ── Mob AI tick (20 Hz) ──────────────────────────────────────────────────

  // Pre-compute max resource radius for grid query radius
  const MAX_RES_RADIUS = Math.max(...worldResources.map(r => r.radius));

  // ── Periodic full mob ID list: lets clients clean up stale local mobs ──
  setInterval(() => {
    if (players.size > 0) {
      io.emit("mob_ids", serverMobs.map(m => m.id));
    }
  }, 5000);

  setInterval(() => {
    // Maintain mob count at all times
    while (serverMobs.length < MAX_MOBS) _spawnMob();

    // Skip expensive AI when no players are online
    if (players.size === 0) return;

    const now = Date.now();
    const mobUpdates: object[] = [];

    for (const mob of serverMobs) {
      // Find nearest alive player (kept as-is; with ≤50 players it's negligible)
      let nearestPlayer: PlayerState | null = null;
      let nearestDist2 = Infinity;
      for (const p of players.values()) {
        if (p.dead) continue;
        const d2 = dist2(mob.x, mob.y, p.x, p.y);
        if (d2 < nearestDist2) { nearestDist2 = d2; nearestPlayer = p; }
      }

      const nearestDist = Math.sqrt(nearestDist2);
      const aggro = mob.provoked ||
        (nearestPlayer && nearestDist < mob.aggroRange) ||
        (now - mob.lastPlayerDmg < 5000);

      if (mob._wanderTargetX === undefined ||
          Math.sqrt(dist2(mob.x, mob.y, mob._wanderTargetX, mob._wanderTargetY ?? mob.leashY)) < 25 ||
          Math.random() < 0.004) {
        const wr = 120 + Math.random() * 280;
        const wa = Math.random() * Math.PI * 2;
        mob._wanderTargetX = mob.leashX + Math.cos(wa) * wr;
        mob._wanderTargetY = mob.leashY + Math.sin(wa) * wr;
      }
      const tx = aggro && nearestPlayer ? nearestPlayer.x : (mob._wanderTargetX ?? mob.leashX);
      const ty = aggro && nearestPlayer ? nearestPlayer.y : (mob._wanderTargetY ?? mob.leashY);

      if (aggro && nearestPlayer) {
        if (nearestDist < mob.radius + PLAYER_RADIUS + 10) {
          const ATTACK_INTERVAL = 1200;
          if (now - mob.lastPlayerDmg > ATTACK_INTERVAL || mob.lastPlayerDmg === 0) {
            mob.lastPlayerDmg = now;
            nearestPlayer.hp = Math.max(0, nearestPlayer.hp - mob.dmg);
            io.to(nearestPlayer.id).emit("mob_attack", {
              mobId: mob.id, dmg: mob.dmg, hp: nearestPlayer.hp,
            });
            if (nearestPlayer.hp <= 0 && !nearestPlayer.dead) {
              nearestPlayer.dead = true;
              cleanupPlayerBuildings(nearestPlayer.id, io);
              io.emit("player_dead", {
                id: nearestPlayer.id, killer: "mob_" + mob.id, killerName: mob.typeName,
              });
            }
          }
        }
      }

      const leashDist = Math.sqrt(dist2(mob.x, mob.y, mob.leashX, mob.leashY));
      if (leashDist > 1800) { (mob as ServerMob & { _wanderTargetX?: number })._wanderTargetX = mob.leashX; mob.provoked = false; }

      const dx = tx - mob.x, dy = ty - mob.y;
      const d  = Math.sqrt(dx * dx + dy * dy);
      const spd = mob.speed * 60 * (MOB_TICK_MS / 1000);

      if (d > 2) {
        mob.vx = (dx / d) * spd;
        mob.vy = (dy / d) * spd;
        mob.angle = Math.atan2(dy, dx);
      } else {
        mob.vx = 0; mob.vy = 0;
      }

      mob.x += mob.vx;
      mob.y += mob.vy;

      // ── Building collision ─────────────────────────────────────────────
      for (const building of buildings.values()) {
        const bdx = mob.x - building.x;
        const bdy = mob.y - building.y;
        const minD = mob.radius + building.radius;
        const bd2  = bdx * bdx + bdy * bdy;
        if (bd2 < minD * minD && bd2 > 0) {
          const bd   = Math.sqrt(bd2);
          const push = (minD - bd) / bd;
          mob.x += bdx * push;
          mob.y += bdy * push;
        }
      }

      // ── OPTIMIZED resource collision: spatial grid, ~18 checks vs 420 ──
      const checkRadius = mob.radius + MAX_RES_RADIUS;
      const nearbyRes = getNearbyResIndices(mob.x, mob.y, checkRadius);
      for (const ri of nearbyRes) {
        const res = worldResources[ri];
        if (res.hp <= 0) continue;
        const rdx = mob.x - res.x;
        const rdy = mob.y - res.y;
        const minD = mob.radius + res.radius;
        const rd2  = rdx * rdx + rdy * rdy;
        if (rd2 < minD * minD && rd2 > 0) {
          const rd   = Math.sqrt(rd2);
          const push = (minD - rd) / rd;
          mob.x += rdx * push;
          mob.y += rdy * push;
        }
      }

      if (mob.hitFlash > 0) mob.hitFlash--;

      // OPTIMIZATION: only include mob in update if it meaningfully changed
      const movedX     = Math.abs(mob.x  - mob._prevX)     > 0.5;
      const movedY     = Math.abs(mob.y  - mob._prevY)     > 0.5;
      const hpChanged  = mob.hp        !== mob._prevHp;
      const flashChanged = mob.hitFlash !== mob._prevHitFlash;

      if (movedX || movedY || hpChanged || flashChanged) {
        mob._prevX = mob.x; mob._prevY = mob.y;
        mob._prevHp = mob.hp; mob._prevHitFlash = mob.hitFlash;
        mobUpdates.push({
          id: mob.id, x: mob.x, y: mob.y, vx: mob.vx, vy: mob.vy,
          hp: mob.hp, maxHp: mob.maxHp, hitFlash: mob.hitFlash, angle: mob.angle,
        });
      }
    }

    if (mobUpdates.length > 0) io.emit("mob_states", mobUpdates);
  }, MOB_TICK_MS);

  // ── OPTIMIZED: Broadcast player states every 100ms (was 50ms) ───────────
  // Halves player state network traffic; 10Hz is imperceptible with client
  // interpolation via vx/vy dead-reckoning already in the client.
  setInterval(() => {
    if (players.size === 0) return;
    const snapshot: Record<string, object> = {};
    players.forEach((p, id) => {
      if (!p.dead) {
        snapshot[id] = {
          n: p.name, sk: p.skin, color: p.color, team: p.team, rk: p.rankId,
          x: p.x, y: p.y, a: p.angle, vx: p.vx, vy: p.vy,
          hp: p.hp, mhp: p.maxHp, w: p.weapon, atk: p.isAttacking,
          k: p.kills, xp: p.xp, g: p.gold ?? 0, sc: p.score ?? 0,
          at: p.axeTier, st: p.swordTier,
          bx: p.buildX ?? null, by: p.buildY ?? null, acc: p.acc || {},
        };
      }
    });
    io.emit("players", snapshot);
  }, 100);

  return httpServer;
}
