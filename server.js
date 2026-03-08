require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { createClient } = require('@supabase/supabase-js');
const { Keypair, Connection, PublicKey, Transaction, VersionedTransaction, SystemProgram, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const bs58 = require('bs58');

// =====================================================
//  SUPABASE
// =====================================================
const SUPABASE_URL = 'https://tbmptvntfrwuewuzdgjk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRibXB0dm50ZnJ3dWV3dXpkZ2prIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5NDE2OTAsImV4cCI6MjA4ODUxNzY5MH0.0E_eQ798eHpkQPuxxSzoVQMMXP12oT2EvcWPmbfAEbY';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// =====================================================
//  SOLANA CONFIG
// =====================================================
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const TREASURY_PRIVATE_KEY = process.env.TREASURY_WALLET_PRIVATE_KEY || '';
const TREASURY_PUBLIC_KEY = process.env.TREASURY_WALLET_PUBLIC_KEY || '';
const DEV_WALLET_PRIVATE_KEY = process.env.DEV_WALLET_PRIVATE_KEY || '';
const DEV_WALLET_PUBLIC_KEY = process.env.DEV_WALLET_PUBLIC_KEY || '';
const PUMPFUN_TOKEN_ADDRESS = process.env.PUMPFUN_TOKEN_ADDRESS || '';
const PLATFORM_FEE_PERCENT = parseFloat(process.env.PLATFORM_FEE_PERCENT || '5');
const solanaConnection = new Connection(SOLANA_RPC_URL, 'confirmed');

const ENTRY_FEE_OPTIONS = [0, 0.02, 0.05, 0.1, 0.5]; // 0 = free

// Startup diagnostics for PumpFun auto-buy
console.log(`[PumpFun Config] DEV_WALLET_PUBLIC_KEY: ${DEV_WALLET_PUBLIC_KEY || 'NOT SET'}`);
console.log(`[PumpFun Config] DEV_WALLET_PRIVATE_KEY: ${DEV_WALLET_PRIVATE_KEY ? DEV_WALLET_PRIVATE_KEY.slice(0, 8) + '...' : 'NOT SET'}`);
console.log(`[PumpFun Config] PUMPFUN_TOKEN_ADDRESS: ${PUMPFUN_TOKEN_ADDRESS || 'NOT SET'}`);
console.log(`[PumpFun Config] SOLANA_RPC_URL: ${SOLANA_RPC_URL}`);

// =====================================================
//  CONFIG
// =====================================================
const PORT = process.env.PORT || 3000;
const TICK_RATE = 60;
const ARENA_W = 1600;
const ARENA_H = 1000;
const LOBBY_COUNTDOWN = 5;
const ROUND_RESTART_DELAY = 5;
const ROUNDS_TO_WIN = 3; // Best of 5: first to 3 wins

const MODE_CONFIG = {
  '1v1': { maxPlayers: 2, teams: 2, perTeam: 1 },
  '2v2': { maxPlayers: 4, teams: 2, perTeam: 2 },
  '3v3': { maxPlayers: 6, teams: 2, perTeam: 3 },
};

// Player constants
const PLAYER_SPEED = 5.0;
const PLAYER_W = 28;
const PLAYER_H = 32;
const PUNCH_RANGE = 80;
const PUNCH_ARC = Math.PI * 0.7;
const PUNCH_DAMAGE = 25;
const PUNCH_COOLDOWN = 0.35;
const PUNCH_DURATION = 0.2;
const DASH_SPEED = 16;
const DASH_DURATION = 0.18;
const DASH_COOLDOWN = 1.2;
const SHIELD_DURATION = 2;
const SHIELD_COOLDOWN = 8;
const SUPER_PUNCH_DAMAGE = 60;
const SUPER_PUNCH_CHARGE_TIME = 15;
const PLUSHIE_SPEED = 12;
const PLUSHIE_DAMAGE = 20;
const PLUSHIE_COOLDOWN = 3;
const PLUSHIE_MAX_DIST = 400;
const KNOCKBACK_FORCE = 12;
const MAX_HP = 100;
const INVINCIBLE_TIME = 0.5;

const SPAWN_POSITIONS = [
  { x: 200, y: 200 },
  { x: ARENA_W - 200, y: 200 },
  { x: 200, y: ARENA_H - 200 },
  { x: ARENA_W - 200, y: ARENA_H - 200 },
  { x: ARENA_W / 2, y: 150 },
  { x: ARENA_W / 2, y: ARENA_H - 150 },
];

const PLAYER_COLORS = [
  '#ff6644', '#44aaff', '#44dd66', '#ffcc22', '#cc66ff', '#ff66aa'
];

// =====================================================
//  LOBBY MANAGER (multiple lobbies)
// =====================================================
let lobbies = {}; // lobbyId -> lobby object
let globalClients = {}; // visitorId -> { ws, userId, username }

function createLobbyInstance(lobbyDbId, name, mode, createdBy, entryFee) {
  const cfg = MODE_CONFIG[mode];
  return {
    id: lobbyDbId,
    name,
    mode,
    maxPlayers: cfg.maxPlayers,
    teams: cfg.teams,
    perTeam: cfg.perTeam,
    gameState: 'lobby', // 'lobby' | 'countdown' | 'playing' | 'roundEnd' | 'matchEnd'
    countdownTimer: 0,
    roundEndTimer: 0,
    winnerId: null,
    winnerTeam: null,
    gameTime: 0,
    players: {},
    clients: {},
    spectators: {}, // visitorId -> ws (external watchers + eliminated players)
    projectiles: [],
    nextProjectileId: 0,
    particles: [],
    createdBy,
    entryFee: entryFee || 0,
    prizePool: 0,
    // Best of 5 tracking
    roundScores: { 1: 0, 2: 0 }, // team -> rounds won
    currentRound: 1,
    matchWinnerTeam: null,
  };
}

function createPlayer(id, slotIndex, username, team, userId) {
  const spawn = SPAWN_POSITIONS[slotIndex % SPAWN_POSITIONS.length];
  return {
    id,
    visitorId: id,
    userId,
    slot: slotIndex,
    name: username,
    color: PLAYER_COLORS[slotIndex % PLAYER_COLORS.length],
    team,
    x: spawn.x,
    y: spawn.y,
    vx: 0, vy: 0,
    hp: MAX_HP,
    alive: true,
    facing: 1,
    aimAngle: 0,
    punching: false, punchTimer: 0, punchCooldown: 0,
    dashing: false, dashTimer: 0, dashCooldown: 0, dashDirX: 0, dashDirY: 0,
    shieldActive: false, shieldTimer: 0, shieldCooldown: 0,
    superPunchCharge: 0, superPunchReady: false, usingSuperPunch: false,
    plushieCooldown: 0,
    invincibleTimer: 0,
    input: { up: false, down: false, left: false, right: false, punch: false, dash: false, shield: false, superPunch: false, plushieThrow: false, aimAngle: 0 },
    kills: 0, damageDealt: 0,
    ready: false,
  };
}

function getNextSlot(lobby) {
  let usedSlots = new Set(Object.values(lobby.players).map(p => p.slot));
  for (let i = 0; i < lobby.maxPlayers; i++) {
    if (!usedSlots.has(i)) return i;
  }
  return -1;
}

function getTeamForSlot(lobby, slot) {
  // Team 1 gets first half of slots, team 2 gets second half
  return slot < lobby.perTeam ? 1 : 2;
}

function getPlayerCount(lobby) {
  return Object.keys(lobby.players).length;
}

function getAliveCount(lobby) {
  return Object.values(lobby.players).filter(p => p.alive).length;
}

function getAliveTeams(lobby) {
  let teams = new Set();
  Object.values(lobby.players).forEach(p => { if (p.alive) teams.add(p.team); });
  return teams;
}

// =====================================================
//  GAME LOGIC TICK (per lobby)
// =====================================================
function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function tickLobby(lobby, dt) {
  if (lobby.gameState === 'lobby') {
    let pCount = getPlayerCount(lobby);
    let readyCount = Object.values(lobby.players).filter(p => p.ready).length;
    if (pCount === lobby.maxPlayers && readyCount === pCount) {
      lobby.gameState = 'countdown';
      lobby.countdownTimer = LOBBY_COUNTDOWN;
    }
    return;
  }

  if (lobby.gameState === 'countdown') {
    lobby.countdownTimer -= dt;
    let pCount = getPlayerCount(lobby);
    let readyCount = Object.values(lobby.players).filter(p => p.ready).length;
    if (pCount < lobby.maxPlayers || readyCount < pCount) {
      lobby.gameState = 'lobby';
      lobby.countdownTimer = 0;
      return;
    }
    if (lobby.countdownTimer <= 0) {
      lobby.gameState = 'playing';
      lobby.gameTime = 0;
      for (let id in lobby.players) {
        lobby.players[id].alive = true;
        lobby.players[id].hp = MAX_HP;
        lobby.players[id].superPunchCharge = 0;
        lobby.players[id].superPunchReady = false;
      }
      // Update lobby status in DB
      supabase.from('lobbies').update({ status: 'playing', started_at: new Date().toISOString() }).eq('id', lobby.id).then(() => {});
    }
    return;
  }

  if (lobby.gameState === 'roundEnd') {
    lobby.particles = [];
    lobby.roundEndTimer -= dt;
    if (lobby.roundEndTimer <= 0) {
      // Not match over yet — reset for next round
      resetRound(lobby);
    }
    return;
  }

  if (lobby.gameState === 'matchEnd') {
    lobby.particles = [];
    lobby.roundEndTimer -= dt;
    if (lobby.roundEndTimer <= 0) {
      finishLobby(lobby).catch(err => console.error('[FinishLobby] Unhandled error:', err.message, err.stack));
    }
    return;
  }

  // === PLAYING STATE ===
  lobby.gameTime += dt;
  lobby.particles = [];

  let players = lobby.players;
  let projectiles = lobby.projectiles;

  for (let id in players) {
    let p = players[id];
    if (!p.alive) continue;

    if (p.punchCooldown > 0) p.punchCooldown -= dt;
    if (p.dashCooldown > 0) p.dashCooldown -= dt;
    if (p.shieldCooldown > 0) p.shieldCooldown -= dt;
    if (p.plushieCooldown > 0) p.plushieCooldown -= dt;
    if (p.invincibleTimer > 0) p.invincibleTimer -= dt;

    if (!p.superPunchReady) {
      p.superPunchCharge += dt;
      if (p.superPunchCharge >= SUPER_PUNCH_CHARGE_TIME) p.superPunchReady = true;
    }

    let inp = p.input;
    p.aimAngle = inp.aimAngle;
    p.facing = Math.cos(p.aimAngle) >= 0 ? 1 : -1;

    if (p.dashing) {
      p.dashTimer -= dt;
      p.x += p.dashDirX * DASH_SPEED;
      p.y += p.dashDirY * DASH_SPEED;
      if (p.dashTimer <= 0) p.dashing = false;
    } else {
      let mx = 0, my = 0;
      if (inp.left) mx -= 1;
      if (inp.right) mx += 1;
      if (inp.up) my -= 1;
      if (inp.down) my += 1;
      let len = Math.sqrt(mx * mx + my * my);
      if (len > 0) { mx /= len; my /= len; }
      p.vx = mx * PLAYER_SPEED;
      p.vy = my * PLAYER_SPEED;
      p.x += p.vx;
      p.y += p.vy;

      if (inp.dash && p.dashCooldown <= 0 && len > 0) {
        p.dashing = true;
        p.dashTimer = DASH_DURATION;
        p.dashCooldown = DASH_COOLDOWN;
        p.dashDirX = mx;
        p.dashDirY = my;
        p.invincibleTimer = DASH_DURATION;
      }
    }

    p.x = Math.max(PLAYER_W, Math.min(ARENA_W - PLAYER_W, p.x));
    p.y = Math.max(PLAYER_H, Math.min(ARENA_H - PLAYER_H, p.y));

    if (inp.shield && !p.shieldActive && p.shieldCooldown <= 0) {
      p.shieldActive = true;
      p.shieldTimer = SHIELD_DURATION;
    }
    if (p.shieldActive) {
      p.shieldTimer -= dt;
      if (p.shieldTimer <= 0) {
        p.shieldActive = false;
        p.shieldCooldown = SHIELD_COOLDOWN;
      }
    }

    if (p.punching) {
      p.punchTimer -= dt;
      if (p.punchTimer <= 0) p.punching = false;
    }
    if (inp.punch && !p.punching && p.punchCooldown <= 0 && !p.dashing) {
      p.punching = true;
      p.punchTimer = PUNCH_DURATION;
      p.punchCooldown = PUNCH_COOLDOWN;
      p.usingSuperPunch = inp.superPunch && p.superPunchReady;
      if (p.usingSuperPunch) {
        p.superPunchReady = false;
        p.superPunchCharge = 0;
      }

      let dmg = p.usingSuperPunch ? SUPER_PUNCH_DAMAGE : PUNCH_DAMAGE;
      let range = p.usingSuperPunch ? PUNCH_RANGE * 1.5 : PUNCH_RANGE;
      let arc = p.usingSuperPunch ? PUNCH_ARC * 1.3 : PUNCH_ARC;

      for (let oid in players) {
        if (oid === id) continue;
        let o = players[oid];
        if (!o.alive) continue;
        if (o.invincibleTimer > 0) continue;
        if (o.team === p.team) continue; // no friendly fire

        let dx = o.x - p.x;
        let dy = o.y - p.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        let angle = Math.atan2(dy, dx);
        let angleDiff = Math.abs(normalizeAngle(angle - p.aimAngle));

        if (dist < range + PLAYER_W / 2 && angleDiff < arc / 2) {
          if (o.shieldActive) {
            applyDamage(lobby, o, p, Math.floor(dmg * 0.2));
            let kb = KNOCKBACK_FORCE * 0.5;
            o.x += Math.cos(angle) * kb;
            o.y += Math.sin(angle) * kb;
            lobby.particles.push({ type: 'shieldHit', x: o.x, y: o.y });
          } else {
            applyDamage(lobby, o, p, dmg);
            let kb = p.usingSuperPunch ? KNOCKBACK_FORCE * 2 : KNOCKBACK_FORCE;
            o.x += Math.cos(angle) * kb;
            o.y += Math.sin(angle) * kb;
            o.invincibleTimer = INVINCIBLE_TIME;
            lobby.particles.push({ type: 'hit', x: o.x, y: o.y, big: p.usingSuperPunch });
          }
        }
      }
    }

    if (inp.plushieThrow && p.plushieCooldown <= 0 && !p.dashing) {
      p.plushieCooldown = PLUSHIE_COOLDOWN;
      projectiles.push({
        id: lobby.nextProjectileId++,
        ownerId: id,
        ownerTeam: p.team,
        x: p.x, y: p.y,
        vx: Math.cos(p.aimAngle) * PLUSHIE_SPEED,
        vy: Math.sin(p.aimAngle) * PLUSHIE_SPEED,
        dist: 0, alive: true,
      });
    }

    p.input.punch = false;
    p.input.dash = false;
    p.input.plushieThrow = false;
    p.input.superPunch = false;
  }

  for (let proj of projectiles) {
    if (!proj.alive) continue;
    proj.x += proj.vx;
    proj.y += proj.vy;
    proj.dist += Math.sqrt(proj.vx * proj.vx + proj.vy * proj.vy);

    if (proj.dist > PLUSHIE_MAX_DIST || proj.x < 0 || proj.x > ARENA_W || proj.y < 0 || proj.y > ARENA_H) {
      proj.alive = false;
      continue;
    }

    for (let id in players) {
      if (id === proj.ownerId) continue;
      let o = players[id];
      if (!o.alive || o.invincibleTimer > 0) continue;
      if (o.team === proj.ownerTeam) continue; // no friendly fire
      let dx = o.x - proj.x;
      let dy = o.y - proj.y;
      let dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < PLAYER_W + 10) {
        if (o.shieldActive) {
          applyDamage(lobby, o, players[proj.ownerId], Math.floor(PLUSHIE_DAMAGE * 0.2));
          lobby.particles.push({ type: 'shieldHit', x: o.x, y: o.y });
        } else {
          applyDamage(lobby, o, players[proj.ownerId], PLUSHIE_DAMAGE);
          let angle = Math.atan2(dy, dx);
          o.x += Math.cos(angle) * KNOCKBACK_FORCE * 0.7;
          o.y += Math.sin(angle) * KNOCKBACK_FORCE * 0.7;
          o.invincibleTimer = INVINCIBLE_TIME;
          lobby.particles.push({ type: 'hit', x: o.x, y: o.y, big: false });
        }
        proj.alive = false;
        break;
      }
    }
  }
  lobby.projectiles = projectiles.filter(p => p.alive);

  // --- CHECK WIN CONDITION (team-based, Best of 5) ---
  let aliveTeams = getAliveTeams(lobby);
  if (aliveTeams.size <= 1) {
    if (aliveTeams.size === 1) {
      let roundWinner = [...aliveTeams][0];
      lobby.winnerTeam = roundWinner;
      lobby.roundScores[roundWinner]++;
      let winners = Object.values(lobby.players).filter(p => p.team === roundWinner);
      lobby.winnerId = winners.length > 0 ? winners[0].id : null;
    } else {
      // Draw — no one gets a point
      lobby.winnerTeam = null;
      lobby.winnerId = null;
    }

    // Check if a team won the match (Best of 5 = first to 3)
    if (lobby.roundScores[1] >= ROUNDS_TO_WIN || lobby.roundScores[2] >= ROUNDS_TO_WIN) {
      lobby.gameState = 'matchEnd';
      lobby.matchWinnerTeam = lobby.roundScores[1] >= ROUNDS_TO_WIN ? 1 : 2;
      lobby.roundEndTimer = ROUND_RESTART_DELAY;
    } else {
      lobby.gameState = 'roundEnd';
      lobby.roundEndTimer = ROUND_RESTART_DELAY;
    }
    // Clear particles and projectiles immediately so they aren't re-broadcast every tick
    lobby.projectiles = [];
  }
}

function applyDamage(lobby, victim, attacker, dmg) {
  victim.hp -= dmg;
  if (attacker) attacker.damageDealt += dmg;
  if (victim.hp <= 0) {
    victim.hp = 0;
    victim.alive = false;
    if (attacker) attacker.kills++;
    lobby.particles.push({ type: 'kill', x: victim.x, y: victim.y, name: victim.name, killerName: attacker ? attacker.name : '?' });
  }
}

// =====================================================
//  RESET ROUND — Reset players for next round (Best of 5)
// =====================================================
function resetRound(lobby) {
  lobby.currentRound++;
  lobby.gameState = 'countdown';
  lobby.countdownTimer = LOBBY_COUNTDOWN;
  lobby.winnerTeam = null;
  lobby.winnerId = null;
  lobby.projectiles = [];
  lobby.particles = [];
  lobby.gameTime = 0;

  for (let id in lobby.players) {
    let p = lobby.players[id];
    let spawn = SPAWN_POSITIONS[p.slot % SPAWN_POSITIONS.length];
    p.x = spawn.x;
    p.y = spawn.y;
    p.vx = 0; p.vy = 0;
    p.hp = MAX_HP;
    p.alive = true;
    p.punching = false; p.punchTimer = 0; p.punchCooldown = 0;
    p.dashing = false; p.dashTimer = 0; p.dashCooldown = 0;
    p.shieldActive = false; p.shieldTimer = 0; p.shieldCooldown = 0;
    p.superPunchCharge = 0; p.superPunchReady = false; p.usingSuperPunch = false;
    p.plushieCooldown = 0;
    p.invincibleTimer = 0;
    p.input = { up: false, down: false, left: false, right: false, punch: false, dash: false, shield: false, superPunch: false, plushieThrow: false, aimAngle: 0 };
  }
}

// =====================================================
//  FINISH LOBBY — Record game history + distribute prizes
// =====================================================
async function finishLobby(lobby) {
  if (lobby.finished) return;
  lobby.finished = true;
  lobby.gameState = 'finished';

  const winnerTeam = lobby.matchWinnerTeam || lobby.winnerTeam;

  // Distribute prize pool to winning team
  if (lobby.prizePool > 0 && winnerTeam) {
    const platformFee = lobby.prizePool * (PLATFORM_FEE_PERCENT / 100);
    const distributablePool = lobby.prizePool - platformFee;
    const winningPlayers = Object.values(lobby.players).filter(p => p.team === winnerTeam && p.userId);
    if (winningPlayers.length > 0) {
      const prizePerPlayer = distributablePool / winningPlayers.length;
      for (let p of winningPlayers) {
        try {
          const { data: user } = await supabase.from('users').select('balance').eq('id', p.userId).single();
          if (user) {
            await supabase.from('users').update({
              balance: parseFloat(user.balance) + prizePerPlayer,
            }).eq('id', p.userId);
            await supabase.from('transactions').insert({
              user_id: p.userId,
              type: 'prize_win',
              amount: prizePerPlayer,
              status: 'confirmed',
            });
          }
        } catch (e) {
          console.error('Error distributing prize:', e.message);
        }
      }
    }
  }

  // Record game history for each player
  for (let id in lobby.players) {
    let p = lobby.players[id];
    if (!p.userId) continue;

    let won = p.team === winnerTeam;
    let ratingChange = won ? 25 : -15;

    try {
      await supabase.from('game_history').insert({
        lobby_id: lobby.id,
        user_id: p.userId,
        mode: lobby.mode,
        team: p.team,
        kills: p.kills,
        damage_dealt: p.damageDealt,
        survived: p.alive,
        won: won,
        rating_change: ratingChange,
      });

      const { data: user } = await supabase.from('users').select('*').eq('id', p.userId).single();
      if (user) {
        await supabase.from('users').update({
          total_wins: user.total_wins + (won ? 1 : 0),
          total_losses: user.total_losses + (won ? 0 : 1),
          total_kills: user.total_kills + p.kills,
          total_damage: user.total_damage + p.damageDealt,
          games_played: user.games_played + 1,
          rating: Math.max(0, user.rating + ratingChange),
        }).eq('id', p.userId);
      }
    } catch (e) {
      console.error('Error recording game history:', e.message);
    }
  }

  // Update lobby as finished
  await supabase.from('lobbies').update({
    status: 'finished',
    winner_team: winnerTeam,
    finished_at: new Date().toISOString(),
    current_players: 0,
  }).eq('id', lobby.id);

  await supabase.from('lobby_players').delete().eq('lobby_id', lobby.id);

  // Notify clients and spectators
  broadcastToLobby(lobby, { type: 'lobbyFinished', winnerTeam, matchWinnerTeam: winnerTeam, roundScores: lobby.roundScores });

  // Auto-buy pumpfun token after game ends
  try {
    await triggerPumpfunBuy(lobby.id);
  } catch (buyErr) {
    console.error('[PumpFun] Buy trigger error in finishLobby:', buyErr.message);
  }

  // Disconnect all players + spectators from this lobby
  for (let vid in lobby.clients) {
    let gc = globalClients[vid];
    if (gc) gc.currentLobby = null;
  }
  for (let vid in lobby.spectators) {
    let gc = globalClients[vid];
    if (gc) { gc.currentLobby = null; gc.spectating = null; }
  }
  delete lobbies[lobby.id];
  broadcastLobbyList();
}

// =====================================================
//  PUMPFUN AUTO-BUY (0.01 SOL from dev wallet via PumpPortal API)
// =====================================================
async function triggerPumpfunBuy(lobbyId) {
  if (!DEV_WALLET_PRIVATE_KEY || DEV_WALLET_PRIVATE_KEY === 'YOUR_DEV_WALLET_PRIVATE_KEY_HERE') {
    console.log('[PumpFun] Dev wallet not configured, skipping auto-buy');
    return;
  }
  if (!PUMPFUN_TOKEN_ADDRESS || PUMPFUN_TOKEN_ADDRESS === 'YOUR_PUMPFUN_TOKEN_ADDRESS_HERE') {
    console.log('[PumpFun] Token address not configured, skipping auto-buy');
    return;
  }

  try {
    const bs58Decode = bs58.default ? bs58.default.decode : bs58.decode;
    console.log('[PumpFun] Decoding dev wallet private key...');
    const devKeypair = Keypair.fromSecretKey(bs58Decode(DEV_WALLET_PRIVATE_KEY));
    const devPubKey = devKeypair.publicKey.toBase58();
    const buyAmountSOL = 0.01;

    // Check dev wallet balance before attempting buy
    let devBalance = 0;
    try {
      const devLamports = await solanaConnection.getBalance(devKeypair.publicKey, 'confirmed');
      devBalance = devLamports / LAMPORTS_PER_SOL;
      console.log(`[PumpFun] Dev wallet ${devPubKey} balance: ${devBalance} SOL`);
    } catch (balErr) {
      console.error('[PumpFun] Failed to check dev wallet balance:', balErr.message);
    }

    if (devBalance < buyAmountSOL + 0.001) {
      console.error(`[PumpFun] Insufficient dev wallet balance (${devBalance} SOL). Need at least ${buyAmountSOL + 0.001} SOL. Skipping buy.`);
      await supabase.from('pumpfun_buys').insert({
        lobby_id: lobbyId,
        tx_signature: null,
        amount_sol: buyAmountSOL,
        token_address: PUMPFUN_TOKEN_ADDRESS,
        status: 'failed',
      }).catch(() => {});
      return;
    }

    console.log(`[PumpFun] Initiating ${buyAmountSOL} SOL buy for token ${PUMPFUN_TOKEN_ADDRESS} from wallet ${devPubKey}`);

    // Request a serialized swap transaction from PumpPortal API
    const requestBody = {
      publicKey: devPubKey,
      action: 'buy',
      mint: PUMPFUN_TOKEN_ADDRESS,
      amount: buyAmountSOL,
      denominatedInSol: true,
      slippage: 25,
      priorityFee: 0.0005,
      pool: 'pump',
    };
    console.log('[PumpFun] Sending request to PumpPortal:', JSON.stringify(requestBody));

    const response = await fetch('https://pumpportal.fun/api/trade-local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (response.status !== 200) {
      const errText = await response.text();
      throw new Error(`PumpPortal API error ${response.status}: ${errText}`);
    }

    // Deserialize, sign, and send the transaction
    const data = await response.arrayBuffer();
    console.log(`[PumpFun] Received transaction data (${data.byteLength} bytes), deserializing...`);
    const tx = VersionedTransaction.deserialize(new Uint8Array(data));
    tx.sign([devKeypair]);
    console.log('[PumpFun] Transaction signed, sending to Solana...');

    const txSignature = await solanaConnection.sendTransaction(tx, {
      skipPreflight: true,
      maxRetries: 5,
    });
    console.log(`[PumpFun] Buy tx sent: https://solscan.io/tx/${txSignature}`);

    // Wait for confirmation
    try {
      const confirmation = await solanaConnection.confirmTransaction(txSignature, 'confirmed');
      if (confirmation.value && confirmation.value.err) {
        console.error('[PumpFun] Transaction confirmed but failed on-chain:', JSON.stringify(confirmation.value.err));
        await supabase.from('pumpfun_buys').insert({
          lobby_id: lobbyId,
          tx_signature: txSignature,
          amount_sol: buyAmountSOL,
          token_address: PUMPFUN_TOKEN_ADDRESS,
          status: 'failed',
        }).catch(() => {});
        return;
      }
      console.log(`[PumpFun] Buy CONFIRMED: https://solscan.io/tx/${txSignature}`);
    } catch (confErr) {
      console.warn('[PumpFun] Could not confirm tx (may still succeed):', confErr.message);
    }

    await supabase.from('pumpfun_buys').insert({
      lobby_id: lobbyId,
      tx_signature: txSignature,
      amount_sol: buyAmountSOL,
      token_address: PUMPFUN_TOKEN_ADDRESS,
      status: 'confirmed',
    });
  } catch (e) {
    console.error('[PumpFun] Auto-buy failed:', e.message);
    console.error('[PumpFun] Full error:', e.stack || e);
    await supabase.from('pumpfun_buys').insert({
      lobby_id: lobbyId,
      tx_signature: null,
      amount_sol: 0.01,
      token_address: PUMPFUN_TOKEN_ADDRESS,
      status: 'failed',
    }).catch(() => {});
  }
}

// =====================================================
//  NETWORKING
// =====================================================
function broadcastToLobby(lobby, extraData) {
  let state = {
    type: 'gameState',
    lobbyId: lobby.id,
    lobbyName: lobby.name,
    mode: lobby.mode,
    gameState: lobby.gameState,
    countdownTimer: Math.ceil(lobby.countdownTimer),
    roundEndTimer: Math.ceil(lobby.roundEndTimer),
    winnerId: lobby.winnerId,
    winnerTeam: lobby.winnerTeam,
    matchWinnerTeam: lobby.matchWinnerTeam,
    gameTime: lobby.gameTime,
    arenaW: ARENA_W,
    arenaH: ARENA_H,
    maxPlayers: lobby.maxPlayers,
    roundScores: lobby.roundScores,
    currentRound: lobby.currentRound,
    entryFee: lobby.entryFee,
    prizePool: lobby.prizePool,
    players: {},
    projectiles: lobby.projectiles.map(p => ({ id: p.id, x: p.x, y: p.y, ownerId: p.ownerId })),
    particles: lobby.particles,
    ...extraData,
  };

  for (let id in lobby.players) {
    let p = lobby.players[id];
    state.players[id] = {
      id: p.id, slot: p.slot, name: p.name, color: p.color, team: p.team,
      x: p.x, y: p.y, hp: p.hp, alive: p.alive, facing: p.facing,
      aimAngle: p.aimAngle, punching: p.punching, dashing: p.dashing,
      shieldActive: p.shieldActive, superPunchReady: p.superPunchReady,
      usingSuperPunch: p.usingSuperPunch, kills: p.kills, damageDealt: p.damageDealt,
      ready: p.ready, invincible: p.invincibleTimer > 0,
    };
  }

  let msg = JSON.stringify(state);
  // Send to players
  for (let vid in lobby.clients) {
    try { lobby.clients[vid].send(msg); } catch (e) {}
  }
  // Send to spectators
  for (let vid in lobby.spectators) {
    try { lobby.spectators[vid].send(msg); } catch (e) {}
  }
}

function broadcastLobbyList() {
  let list = Object.values(lobbies).map(l => ({
    id: l.id, name: l.name, mode: l.mode,
    maxPlayers: l.maxPlayers,
    currentPlayers: getPlayerCount(l),
    gameState: l.gameState,
    createdBy: l.createdBy,
    entryFee: l.entryFee,
    prizePool: l.prizePool,
    roundScores: l.roundScores,
    currentRound: l.currentRound,
    spectatorCount: Object.keys(l.spectators).length,
  }));

  let msg = JSON.stringify({ type: 'lobbyList', lobbies: list });
  for (let vid in globalClients) {
    try { globalClients[vid].ws.send(msg); } catch (e) {}
  }
}

// =====================================================
//  HTTP SERVER
// =====================================================
const server = http.createServer((req, res) => {
  // CORS headers for Supabase
  const allowedOrigins = ['https://www.punchvslulu.fun', 'https://punchvslulu.fun', 'http://localhost:3000', 'http://127.0.0.1:3000'];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin) || !origin) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  } else {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0]);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) { res.writeHead(500); res.end('Error'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
    return;
  }

  if (req.url === '/client.js') {
    fs.readFile(path.join(__dirname, 'client.js'), (err, data) => {
      if (err) { res.writeHead(500); res.end('Error'); return; }
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(data);
    });
    return;
  }

  if (req.url === '/lobby-bg.jpg') {
    fs.readFile(path.join(__dirname, 'lobby-bg.jpg'), (err, data) => {
      if (err) { res.writeHead(500); res.end('Error'); return; }
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      res.end(data);
    });
    return;
  }

  // API: Signup
  if (req.url === '/api/signup' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { username } = JSON.parse(body);
        if (!username || username.length < 2 || username.length > 20) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Username must be 2-20 characters' }));
          return;
        }

        // Check if username exists
        const { data: existing } = await supabase.from('users').select('id').eq('username', username).single();
        if (existing) {
          res.writeHead(409);
          res.end(JSON.stringify({ error: 'Username already taken' }));
          return;
        }

        // Generate Solana wallet
        const keypair = Keypair.generate();
        const publicKey = keypair.publicKey.toBase58();
        const bs58Encode = bs58.default ? bs58.default.encode : bs58.encode;
        const privateKey = bs58Encode(keypair.secretKey);

        // Insert user
        const { data: user, error } = await supabase.from('users').insert({
          username,
          public_key: publicKey,
          private_key_encrypted: privateKey,
        }).select().single();

        if (error) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: error.message }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          user: { id: user.id, username: user.username, public_key: user.public_key, rating: user.rating },
          wallet: { publicKey, privateKey },
        }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // API: Login (by username)
  if (req.url === '/api/login' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { username } = JSON.parse(body);
        const { data: user, error } = await supabase.from('users').select('*').eq('username', username).single();
        if (!user || error) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'User not found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          user: {
            id: user.id, username: user.username, public_key: user.public_key,
            rating: user.rating, total_wins: user.total_wins, total_losses: user.total_losses,
            total_kills: user.total_kills, games_played: user.games_played, sol_earned: user.sol_earned,
            balance: parseFloat(user.balance || 0),
          },
        }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // API: Get user's internal deposit wallet address
  if (req.url === '/api/deposit-address' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { userId } = JSON.parse(body);
        if (!userId) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing userId' })); return; }

        const { data: user } = await supabase.from('users').select('public_key').eq('id', userId).single();
        if (!user) { res.writeHead(404); res.end(JSON.stringify({ error: 'User not found' })); return; }

        // Also check on-chain balance of the internal wallet
        let onChainBalance = 0;
        try {
          const pubkey = new PublicKey(user.public_key);
          const lamports = await solanaConnection.getBalance(pubkey, 'confirmed');
          onChainBalance = lamports / LAMPORTS_PER_SOL;
        } catch (e) {
          console.log('[DepositAddr] Balance check error:', e.message);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ depositAddress: user.public_key, onChainBalance }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // API: Check deposit — detect SOL on user's internal wallet, sweep to treasury, credit balance
  if (req.url === '/api/deposit-check' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { userId } = JSON.parse(body);
        if (!userId) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing userId' })); return; }

        const { data: user } = await supabase.from('users').select('public_key, private_key_encrypted, balance').eq('id', userId).single();
        if (!user) { res.writeHead(404); res.end(JSON.stringify({ error: 'User not found' })); return; }

        // Check on-chain balance of user's internal wallet
        const userPubkey = new PublicKey(user.public_key);
        const lamports = await solanaConnection.getBalance(userPubkey, 'confirmed');
        const onChainSOL = lamports / LAMPORTS_PER_SOL;

        // Need at least 0.001 SOL (to cover tx fees + min rent) to be worth sweeping
        const MIN_SWEEP = 0.002;
        const TX_FEE_LAMPORTS = 5000; // 0.000005 SOL tx fee

        if (onChainSOL < MIN_SWEEP) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ swept: false, onChainBalance: onChainSOL, message: 'No SOL detected yet' }));
          return;
        }

        // Sweep: transfer from user's internal wallet to treasury
        const bs58Dec = bs58.default ? bs58.default.decode : bs58.decode;
        const userKeypair = Keypair.fromSecretKey(bs58Dec(user.private_key_encrypted));
        const treasuryPubkey = new PublicKey(TREASURY_PUBLIC_KEY);

        // Send all minus tx fee
        const sweepLamports = lamports - TX_FEE_LAMPORTS;
        if (sweepLamports <= 0) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ swept: false, onChainBalance: onChainSOL, message: 'Balance too low to cover fees' }));
          return;
        }

        const sweepSOL = sweepLamports / LAMPORTS_PER_SOL;

        const transaction = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: userKeypair.publicKey,
            toPubkey: treasuryPubkey,
            lamports: sweepLamports,
          })
        );

        transaction.feePayer = userKeypair.publicKey;
        const { blockhash } = await solanaConnection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.sign(userKeypair);

        const txSignature = await solanaConnection.sendRawTransaction(transaction.serialize());
        console.log(`[Deposit] Swept ${sweepSOL.toFixed(6)} SOL from ${user.public_key} to treasury: ${txSignature}`);

        // Wait briefly for confirmation
        try {
          await solanaConnection.confirmTransaction(txSignature, 'confirmed');
        } catch (e) {
          console.log('[Deposit] Confirmation wait:', e.message);
        }

        // Credit user balance
        const currentBalance = parseFloat(user.balance || 0);
        const newBalance = currentBalance + sweepSOL;
        await supabase.from('users').update({ balance: newBalance }).eq('id', userId);

        await supabase.from('transactions').insert({
          user_id: userId,
          type: 'deposit',
          amount: sweepSOL,
          tx_signature: txSignature,
          status: 'confirmed',
        });

        console.log(`[Deposit] Credited ${sweepSOL.toFixed(6)} SOL to ${userId}. New balance: ${newBalance.toFixed(6)}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ swept: true, amount: sweepSOL, txSignature, balance: newBalance }));
      } catch (e) {
        console.error('[Deposit] Sweep error:', e.message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Sweep failed: ' + e.message }));
      }
    });
    return;
  }

  // API: Withdraw (player withdraws from internal balance to their wallet)
  if (req.url === '/api/withdraw' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { userId, amount } = JSON.parse(body);
        if (!userId || !amount || amount <= 0) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Invalid withdraw amount' }));
          return;
        }

        const { data: user } = await supabase.from('users').select('balance, public_key').eq('id', userId).single();
        if (!user) { res.writeHead(404); res.end(JSON.stringify({ error: 'User not found' })); return; }

        const currentBalance = parseFloat(user.balance || 0);
        if (currentBalance < amount) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Insufficient balance' }));
          return;
        }

        let txSignature = null;
        if (TREASURY_PRIVATE_KEY && TREASURY_PRIVATE_KEY !== 'YOUR_TREASURY_PRIVATE_KEY_HERE') {
          try {
            const bs58Dec = bs58.default ? bs58.default.decode : bs58.decode;
            const treasuryKeypair = Keypair.fromSecretKey(bs58Dec(TREASURY_PRIVATE_KEY));
            const userPubkey = new PublicKey(user.public_key);
            const lamports = Math.floor(amount * LAMPORTS_PER_SOL);

            const transaction = new Transaction().add(
              SystemProgram.transfer({
                fromPubkey: treasuryKeypair.publicKey,
                toPubkey: userPubkey,
                lamports,
              })
            );

            transaction.feePayer = treasuryKeypair.publicKey;
            const { blockhash } = await solanaConnection.getLatestBlockhash();
            transaction.recentBlockhash = blockhash;
            transaction.sign(treasuryKeypair);

            txSignature = await solanaConnection.sendRawTransaction(transaction.serialize());
            console.log(`[Withdraw] Sent ${amount} SOL to ${user.public_key}: ${txSignature}`);
          } catch (e) {
            console.error('[Withdraw] Transaction failed:', e.message);
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'Withdrawal transaction failed' }));
            return;
          }
        } else {
          console.log('[Withdraw] Treasury not configured, recording withdrawal only');
        }

        const newBalance = currentBalance - amount;
        await supabase.from('users').update({ balance: newBalance }).eq('id', userId);

        await supabase.from('transactions').insert({
          user_id: userId,
          type: 'withdraw',
          amount: parseFloat(amount),
          tx_signature: txSignature,
          status: txSignature ? 'confirmed' : 'pending',
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, balance: newBalance, txSignature }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // API: Get balance
  if (req.url.startsWith('/api/balance/') && req.method === 'GET') {
    const userId = req.url.split('/api/balance/')[1];
    (async () => {
      try {
        const { data: user, error } = await supabase.from('users').select('balance').eq('id', userId).single();
        if (error || !user) { res.writeHead(404); res.end(JSON.stringify({ error: 'User not found' })); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ balance: parseFloat(user.balance || 0) }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // API: Get transaction history
  if (req.url.startsWith('/api/transactions/') && req.method === 'GET') {
    const userId = req.url.split('/api/transactions/')[1];
    (async () => {
      try {
        const { data, error } = await supabase.from('transactions')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(50);
        if (error) throw error;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ transactions: data || [] }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // API: Leaderboard
  if (req.url === '/api/leaderboard' && req.method === 'GET') {
    (async () => {
      try {
        const { data, error } = await supabase.from('leaderboard').select('*').limit(50);
        if (error) throw error;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ leaderboard: data || [] }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // API: Game history for a user
  if (req.url.startsWith('/api/history/') && req.method === 'GET') {
    const userId = req.url.split('/api/history/')[1];
    (async () => {
      try {
        const { data, error } = await supabase.from('game_history')
          .select('*')
          .eq('user_id', userId)
          .order('played_at', { ascending: false })
          .limit(50);
        if (error) throw error;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ history: data || [] }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

// =====================================================
//  WEBSOCKET SERVER
// =====================================================
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  let visitorId = 'v' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
  globalClients[visitorId] = { ws, userId: null, username: null, currentLobby: null };

  ws.send(JSON.stringify({ type: 'welcome', visitorId }));
  broadcastLobbyList();

  ws.on('message', async (data) => {
    try {
      let msg = JSON.parse(data);
      let gc = globalClients[visitorId];
      if (!gc) return;

      // Auth: identify user
      if (msg.type === 'auth') {
        gc.userId = msg.userId;
        gc.username = msg.username;
        ws.send(JSON.stringify({ type: 'authOk' }));
        broadcastLobbyList();
        return;
      }

      // Create lobby
      if (msg.type === 'createLobby') {
        if (!gc.userId) { ws.send(JSON.stringify({ type: 'error', msg: 'Login first' })); return; }
        const mode = msg.mode;
        const name = msg.name || `${gc.username}'s Lobby`;
        if (!MODE_CONFIG[mode]) { ws.send(JSON.stringify({ type: 'error', msg: 'Invalid mode' })); return; }

        const entryFee = parseFloat(msg.entryFee || 0);
        if (entryFee > 0 && !ENTRY_FEE_OPTIONS.includes(entryFee)) {
          ws.send(JSON.stringify({ type: 'error', msg: 'Invalid entry fee' })); return;
        }

        // Insert into DB
        const { data: lobbyDb, error } = await supabase.from('lobbies').insert({
          name,
          mode,
          max_players: MODE_CONFIG[mode].maxPlayers,
          current_players: 0,
          status: 'waiting',
          created_by: gc.userId,
          entry_fee: entryFee,
          prize_pool: 0,
        }).select().single();

        if (error) { ws.send(JSON.stringify({ type: 'error', msg: error.message })); return; }

        // Create in-memory lobby
        let lobby = createLobbyInstance(lobbyDb.id, name, mode, gc.username, entryFee);
        lobbies[lobby.id] = lobby;

        ws.send(JSON.stringify({ type: 'lobbyCreated', lobbyId: lobby.id }));
        broadcastLobbyList();
        return;
      }

      // Join lobby
      if (msg.type === 'joinLobby') {
        if (!gc.userId) { ws.send(JSON.stringify({ type: 'error', msg: 'Login first' })); return; }
        let lobby = lobbies[msg.lobbyId];
        if (!lobby) { ws.send(JSON.stringify({ type: 'error', msg: 'Lobby not found' })); return; }
        if (lobby.gameState !== 'lobby') { ws.send(JSON.stringify({ type: 'error', msg: 'Game already started' })); return; }
        if (getPlayerCount(lobby) >= lobby.maxPlayers) { ws.send(JSON.stringify({ type: 'error', msg: 'Lobby full' })); return; }

        // Check entry fee
        if (lobby.entryFee > 0) {
          const { data: userData } = await supabase.from('users').select('balance').eq('id', gc.userId).single();
          const userBalance = parseFloat(userData?.balance || 0);
          if (userBalance < lobby.entryFee) {
            ws.send(JSON.stringify({ type: 'error', msg: `Insufficient balance. Need ${lobby.entryFee} SOL. You have ${userBalance.toFixed(4)} SOL.` }));
            return;
          }
          // Deduct entry fee
          await supabase.from('users').update({ balance: userBalance - lobby.entryFee }).eq('id', gc.userId);
          await supabase.from('transactions').insert({
            user_id: gc.userId, type: 'entry_fee',
            amount: lobby.entryFee, status: 'confirmed',
          });
          lobby.prizePool += lobby.entryFee;
          await supabase.from('lobbies').update({ prize_pool: lobby.prizePool }).eq('id', lobby.id);
        }

        // Check if already in a lobby
        if (gc.currentLobby) {
          leaveLobby(visitorId, gc.currentLobby);
        }

        let slot = getNextSlot(lobby);
        let team = getTeamForSlot(lobby, slot);
        let player = createPlayer(visitorId, slot, gc.username, team, gc.userId);
        lobby.players[visitorId] = player;
        lobby.clients[visitorId] = ws;
        gc.currentLobby = lobby.id;

        // Update DB
        await supabase.from('lobby_players').insert({
          lobby_id: lobby.id,
          user_id: gc.userId,
          team,
        });
        await supabase.from('lobbies').update({
          current_players: getPlayerCount(lobby),
        }).eq('id', lobby.id);

        ws.send(JSON.stringify({ type: 'joinedLobby', lobbyId: lobby.id, playerId: visitorId, entryFee: lobby.entryFee }));
        broadcastToLobby(lobby);
        broadcastLobbyList();
        return;
      }

      // Spectate lobby (external watcher — watch button)
      if (msg.type === 'spectateLobby') {
        if (!gc.userId) { ws.send(JSON.stringify({ type: 'error', msg: 'Login first' })); return; }
        let lobby = lobbies[msg.lobbyId];
        if (!lobby) { ws.send(JSON.stringify({ type: 'error', msg: 'Lobby not found' })); return; }

        // Leave current lobby/spectating if any
        if (gc.currentLobby) {
          await leaveLobby(visitorId, gc.currentLobby);
        }
        if (gc.spectating) {
          let oldLobby = lobbies[gc.spectating];
          if (oldLobby) delete oldLobby.spectators[visitorId];
        }

        lobby.spectators[visitorId] = ws;
        gc.spectating = lobby.id;
        gc.currentLobby = lobby.id;

        ws.send(JSON.stringify({ type: 'spectating', lobbyId: lobby.id }));
        broadcastToLobby(lobby);
        broadcastLobbyList();
        return;
      }

      // Stop spectating
      if (msg.type === 'stopSpectating') {
        if (gc.spectating) {
          let lobby = lobbies[gc.spectating];
          if (lobby) delete lobby.spectators[visitorId];
          gc.spectating = null;
          gc.currentLobby = null;
          broadcastLobbyList();
        }
        return;
      }

      // Leave lobby
      if (msg.type === 'leaveLobby') {
        if (gc.currentLobby) {
          await leaveLobby(visitorId, gc.currentLobby);
        }
        return;
      }

      // Ready toggle
      if (msg.type === 'ready') {
        let lobby = lobbies[gc.currentLobby];
        if (!lobby) return;
        let p = lobby.players[visitorId];
        if (!p) return;
        p.ready = !p.ready;
        broadcastToLobby(lobby);
        return;
      }

      // Game input
      if (msg.type === 'input') {
        let lobby = lobbies[gc.currentLobby];
        if (!lobby) return;
        let p = lobby.players[visitorId];
        if (!p) return;

        if (msg.up !== undefined) p.input.up = msg.up;
        if (msg.down !== undefined) p.input.down = msg.down;
        if (msg.left !== undefined) p.input.left = msg.left;
        if (msg.right !== undefined) p.input.right = msg.right;
        if (msg.aimAngle !== undefined) p.input.aimAngle = msg.aimAngle;
        if (msg.shield !== undefined) p.input.shield = msg.shield;
        if (msg.punch) p.input.punch = true;
        if (msg.dash) p.input.dash = true;
        if (msg.plushieThrow) p.input.plushieThrow = true;
        if (msg.superPunch) p.input.superPunch = true;
        return;
      }

      // Request lobby list
      if (msg.type === 'getLobbies') {
        broadcastLobbyList();
        return;
      }

      // Get treasury public key for deposits
      if (msg.type === 'getTreasuryAddress') {
        ws.send(JSON.stringify({ type: 'treasuryAddress', address: TREASURY_PUBLIC_KEY }));
        return;
      }

    } catch (e) {
      console.error('WS message error:', e.message);
    }
  });

  ws.on('close', async () => {
    let gc = globalClients[visitorId];
    if (gc) {
      // Remove from spectators if spectating
      if (gc.spectating) {
        let lobby = lobbies[gc.spectating];
        if (lobby) delete lobby.spectators[visitorId];
      }
      if (gc.currentLobby && !gc.spectating) {
        await leaveLobby(visitorId, gc.currentLobby);
      }
    }
    delete globalClients[visitorId];
  });
});

async function leaveLobby(visitorId, lobbyId) {
  let lobby = lobbies[lobbyId];
  if (!lobby) return;

  let gc = globalClients[visitorId];
  let player = lobby.players[visitorId];

  delete lobby.players[visitorId];
  delete lobby.clients[visitorId];
  if (gc) gc.currentLobby = null;

  // Update DB
  if (gc && gc.userId) {
    await supabase.from('lobby_players').delete().eq('lobby_id', lobbyId).eq('user_id', gc.userId);
  }

  let pCount = getPlayerCount(lobby);

  if (pCount === 0) {
    // Empty lobby — delete it
    await supabase.from('lobbies').delete().eq('id', lobbyId);
    delete lobbies[lobbyId];
  } else {
    await supabase.from('lobbies').update({ current_players: pCount }).eq('id', lobbyId);

    // If mid-game, check if round should end
    if (lobby.gameState === 'playing') {
      let aliveTeams = getAliveTeams(lobby);
      if (aliveTeams.size <= 1) {
        lobby.gameState = 'roundEnd';
        lobby.roundEndTimer = ROUND_RESTART_DELAY;
        if (aliveTeams.size === 1) {
          lobby.winnerTeam = [...aliveTeams][0];
        }
      }
    }
    if (lobby.gameState === 'countdown') {
      lobby.gameState = 'lobby';
      lobby.countdownTimer = 0;
    }

    broadcastToLobby(lobby);
  }
  broadcastLobbyList();
}

// =====================================================
//  GAME LOOP (ticks all active lobbies)
// =====================================================
const tickInterval = 1000 / TICK_RATE;
setInterval(() => {
  for (let id in lobbies) {
    let lobby = lobbies[id];
    tickLobby(lobby, tickInterval / 1000);
    if (lobby.gameState === 'playing' || lobby.gameState === 'countdown' || lobby.gameState === 'roundEnd' || lobby.gameState === 'matchEnd') {
      broadcastToLobby(lobby);
    }
  }
}, tickInterval);

server.listen(PORT, () => {
  console.log(`\n🐵 Punch Simulator PvP server running at http://localhost:${PORT}`);
  console.log(`   Modes: 1v1, 2v2, 3v3 | Best of 5 | Supabase connected`);
  console.log(`   Entry fees: Free, 0.02, 0.05, 0.1, 0.5 SOL`);
  console.log(`   Treasury: ${TREASURY_PUBLIC_KEY || 'NOT CONFIGURED'}`);
  console.log(`   Dev Wallet: ${DEV_WALLET_PUBLIC_KEY || 'NOT CONFIGURED'}`);
  console.log(`   PumpFun Token: ${PUMPFUN_TOKEN_ADDRESS || 'NOT CONFIGURED'}`);
  console.log(`   Arena: ${ARENA_W}x${ARENA_H}\n`);
});
