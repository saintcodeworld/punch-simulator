// =====================================================
//  PUNCH SIMULATOR PvP — MULTIPLAYER CLIENT
// =====================================================
// Set this to your Render backend URL (no trailing slash)
const SERVER_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? ''  // empty = same origin (local dev)
  : 'https://punch-simulator.onrender.com'; // Render backend

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;

// =====================================================
//  SOUND SYSTEM
// =====================================================
let audioCtx = null;
let soundEnabled = true;

function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function playSound(type) {
  if (!audioCtx || !soundEnabled) return;
  try {
    let osc = audioCtx.createOscillator();
    let gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    let t = audioCtx.currentTime;
    switch(type) {
      case 'punch':
        osc.type = 'sawtooth'; osc.frequency.setValueAtTime(200, t);
        osc.frequency.exponentialRampToValueAtTime(80, t + 0.1);
        gain.gain.setValueAtTime(0.15, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        osc.start(t); osc.stop(t + 0.12); break;
      case 'hit':
        osc.type = 'square'; osc.frequency.setValueAtTime(300, t);
        osc.frequency.exponentialRampToValueAtTime(100, t + 0.08);
        gain.gain.setValueAtTime(0.12, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
        osc.start(t); osc.stop(t + 0.1); break;
      case 'kill':
        osc.type = 'sine'; osc.frequency.setValueAtTime(400, t);
        osc.frequency.exponentialRampToValueAtTime(800, t + 0.15);
        gain.gain.setValueAtTime(0.1, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        osc.start(t); osc.stop(t + 0.2); break;
      case 'hurt':
        osc.type = 'sawtooth'; osc.frequency.setValueAtTime(400, t);
        osc.frequency.exponentialRampToValueAtTime(150, t + 0.25);
        gain.gain.setValueAtTime(0.15, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        osc.start(t); osc.stop(t + 0.3); break;
      case 'dash':
        osc.type = 'sine'; osc.frequency.setValueAtTime(600, t);
        osc.frequency.exponentialRampToValueAtTime(1200, t + 0.08);
        gain.gain.setValueAtTime(0.06, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
        osc.start(t); osc.stop(t + 0.1); break;
      case 'countdown':
        osc.type = 'sine'; osc.frequency.setValueAtTime(440, t);
        osc.frequency.setValueAtTime(554, t + 0.1);
        gain.gain.setValueAtTime(0.12, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        osc.start(t); osc.stop(t + 0.3); break;
      case 'win':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523, t);
        osc.frequency.setValueAtTime(659, t + 0.15);
        osc.frequency.setValueAtTime(784, t + 0.3);
        osc.frequency.setValueAtTime(1047, t + 0.45);
        gain.gain.setValueAtTime(0.12, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
        osc.start(t); osc.stop(t + 0.7); break;
      case 'throw':
        osc.type = 'sine'; osc.frequency.setValueAtTime(300, t);
        osc.frequency.exponentialRampToValueAtTime(900, t + 0.15);
        gain.gain.setValueAtTime(0.08, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        osc.start(t); osc.stop(t + 0.18); break;
    }
  } catch(e) {}
}

document.getElementById('soundToggle').addEventListener('click', () => {
  initAudio();
  soundEnabled = !soundEnabled;
  document.getElementById('soundToggle').textContent = soundEnabled ? '🔊' : '🔇';
});

// =====================================================
//  CLIENT STATE
// =====================================================
let myVisitorId = null;
let myPlayerId = null;
let currentUser = null;
let currentLobbyId = null;
let serverState = null;
let lobbyListData = [];
let authMode = 'signup';
let selectedMode = '1v1';
let selectedEntryFee = 0;
let currentScreen = 'auth';
let isSpectating = false;
let treasuryAddress = '';

const SOL_SVG = `<svg style="display:inline-block;vertical-align:middle;width:14px;height:14px;margin-right:2px;" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none"><path fill="url(#si1)" d="M18.413 7.902a.62.62 0 0 1-.411.163H3.58c-.512 0-.77-.585-.416-.928l2.369-2.284a.6.6 0 0 1 .41-.169H20.42c.517 0 .77.59.41.935z"/><path fill="url(#si2)" d="M18.413 19.158a.62.62 0 0 1-.411.158H3.58c-.512 0-.77-.58-.416-.923l2.369-2.29a.6.6 0 0 1 .41-.163H20.42c.517 0 .77.586.41.928z"/><path fill="url(#si3)" d="M18.413 10.473a.62.62 0 0 0-.411-.158H3.58c-.512 0-.77.58-.416.923l2.369 2.29c.111.103.257.16.41.163H20.42c.517 0 .77-.586.41-.928z"/><defs><linearGradient id="si1" x1="3" x2="21.5" y1="55" y2="54.9" gradientUnits="userSpaceOnUse"><stop stop-color="#599db0"/><stop offset="1" stop-color="#47f8c3"/></linearGradient><linearGradient id="si2" x1="3" x2="21.3" y1="9.2" y2="9" gradientUnits="userSpaceOnUse"><stop stop-color="#c44fe2"/><stop offset="1" stop-color="#73b0d0"/></linearGradient><linearGradient id="si3" x1="4" x2="20.3" y1="12" y2="12" gradientUnits="userSpaceOnUse"><stop stop-color="#778cbf"/><stop offset="1" stop-color="#5dcdc9"/></linearGradient></defs></g></svg>`;
const SOL_SVG_SM = SOL_SVG.replace('width:14px;height:14px;', 'width:11px;height:11px;');

function teamName(t) { return t === 1 ? 'Punch' : 'Lulu'; }
function teamNameFull(t) { return t === 1 ? 'Punch Team' : 'Lulu Team'; }

let keys = {};
let mouseX = W / 2, mouseY = H / 2;
let localTime = 0;
let particles = [];
let floatingTexts = [];
let shakeTimer = 0, shakeIntensity = 0;
let lastCountdown = -1;
let ws = null;
let connected = false;
let isRoundOver = false;
let isMatchOver = false;

// =====================================================
//  SCREEN MANAGEMENT
// =====================================================
function hideAllScreens() {
  ['authScreen','walletModal','accountModal','menuScreen','createLobbyScreen','inLobbyScreen','countdownScreen','roundEndScreen','matchEndScreen','leaderboardScreen','historyScreen','depositScreen','withdrawScreen'].forEach(id => {
    let el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
}

function showScreen(name) {
  hideAllScreens();
  currentScreen = name;
  switch(name) {
    case 'auth': document.getElementById('authScreen').classList.remove('hidden'); break;
    case 'wallet': document.getElementById('walletModal').classList.remove('hidden'); break;
    case 'menu': document.getElementById('menuScreen').classList.remove('hidden'); updateUserInfoBar(); break;
    case 'createLobby': document.getElementById('createLobbyScreen').classList.remove('hidden'); break;
    case 'inLobby': document.getElementById('inLobbyScreen').classList.remove('hidden'); break;
    case 'countdown': document.getElementById('countdownScreen').classList.remove('hidden'); break;
    case 'roundEnd': document.getElementById('roundEndScreen').classList.remove('hidden'); break;
    case 'leaderboard': document.getElementById('leaderboardScreen').classList.remove('hidden'); break;
    case 'history': document.getElementById('historyScreen').classList.remove('hidden'); break;
    case 'account': document.getElementById('accountModal').classList.remove('hidden'); break;
    case 'matchEnd': document.getElementById('matchEndScreen').classList.remove('hidden'); break;
    case 'deposit': document.getElementById('depositScreen').classList.remove('hidden'); break;
    case 'withdraw': document.getElementById('withdrawScreen').classList.remove('hidden'); break;
    case 'playing': break;
    case 'spectating': break;
  }
}

// =====================================================
//  AUTH
// =====================================================
function toggleAuthMode() {
  authMode = authMode === 'signup' ? 'login' : 'signup';
  document.getElementById('authTitle').textContent = authMode === 'signup' ? 'Sign Up' : 'Log In';
  document.getElementById('authBtn').textContent = authMode === 'signup' ? 'Create Account' : 'Log In';
  document.getElementById('authToggle').innerHTML = authMode === 'signup'
    ? 'Already have an account? <span>Log In</span>'
    : 'Need an account? <span>Sign Up</span>';
  document.getElementById('authError').textContent = '';
}

async function doAuth() {
  let username = document.getElementById('authUsername').value.trim();
  if (!username || username.length < 2) {
    document.getElementById('authError').textContent = 'Username must be at least 2 characters';
    return;
  }
  let btn = document.getElementById('authBtn');
  btn.disabled = true;
  btn.textContent = 'Loading...';
  document.getElementById('authError').textContent = '';

  try {
    let url = authMode === 'signup' ? '/api/signup' : '/api/login';
    let res = await fetch(SERVER_URL + url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    let data = await res.json();
    if (!res.ok) {
      document.getElementById('authError').textContent = data.error || 'Error';
      btn.disabled = false;
      btn.textContent = authMode === 'signup' ? 'Create Account' : 'Log In';
      return;
    }
    currentUser = data.user;
    localStorage.setItem('punchUser', JSON.stringify(currentUser));
    send({ type: 'auth', userId: currentUser.id, username: currentUser.username });

    if (authMode === 'signup' && data.wallet) {
      document.getElementById('walletPubKey').textContent = data.wallet.publicKey;
      document.getElementById('walletPrivKey').textContent = data.wallet.privateKey;
      localStorage.setItem('punchPrivKey', data.wallet.privateKey);
      showScreen('wallet');
    } else {
      showScreen('menu');
      send({ type: 'getLobbies' });
    }
  } catch (e) {
    document.getElementById('authError').textContent = 'Connection error';
  }
  btn.disabled = false;
  btn.textContent = authMode === 'signup' ? 'Create Account' : 'Log In';
}

function closeWalletModal() {
  showScreen('menu');
  send({ type: 'getLobbies' });
}

function doLogout() {
  currentUser = null;
  localStorage.removeItem('punchUser');
  currentLobbyId = null;
  myPlayerId = null;
  serverState = null;
  showScreen('auth');
}

function tryAutoLogin() {
  let saved = localStorage.getItem('punchUser');
  if (saved) {
    try { currentUser = JSON.parse(saved); return true; } catch(e) {}
  }
  return false;
}

function updateUserInfoBar() {
  if (!currentUser) return;
  let pub = currentUser.public_key || '';
  let shortPub = pub.length > 12 ? pub.slice(0, 6) + '...' + pub.slice(-4) : pub;
  let bal = (currentUser.balance || 0).toFixed(4);
  document.getElementById('userInfoBar').innerHTML =
    `<span class="username">${currentUser.username}</span>
     <span class="rating">Rating: ${currentUser.rating || 1000}</span>
     <span class="wallet-addr" title="${pub}">${shortPub}</span>
     <span style="color:#a0cc60;font-size:13px;font-family:'Bungee',cursive;">${SOL_SVG} ${bal} SOL</span>
     <span style="color:#8a7650;font-size:12px;">W:${currentUser.total_wins||0} L:${currentUser.total_losses||0} K:${currentUser.total_kills||0}</span>`;
}

// =====================================================
//  ACCOUNT MODAL
// =====================================================
let privKeyRevealed = false;

function showAccountModal() {
  if (!currentUser) return;
  showScreen('account');
  document.getElementById('accountUsername').textContent = currentUser.username;
  document.getElementById('accountPubKey').textContent = currentUser.public_key || '—';
  privKeyRevealed = false;
  document.getElementById('accountPrivKey').textContent = 'Click to reveal (stored locally)';
  document.getElementById('accountPrivKey').style.cursor = 'pointer';

  let stats = document.getElementById('accountStats');
  stats.innerHTML = `
    <div class="account-stat"><div class="stat-val">${currentUser.rating || 1000}</div><div class="stat-label">Rating</div></div>
    <div class="account-stat"><div class="stat-val">${currentUser.total_wins || 0}</div><div class="stat-label">Wins</div></div>
    <div class="account-stat"><div class="stat-val">${currentUser.total_losses || 0}</div><div class="stat-label">Losses</div></div>
    <div class="account-stat"><div class="stat-val">${currentUser.total_kills || 0}</div><div class="stat-label">Kills</div></div>
    <div class="account-stat"><div class="stat-val">${currentUser.games_played || 0}</div><div class="stat-label">Games</div></div>
  `;
}

function togglePrivKeyVisibility() {
  let el = document.getElementById('accountPrivKey');
  if (privKeyRevealed) {
    el.textContent = 'Click to reveal (stored locally)';
    privKeyRevealed = false;
  } else {
    let savedKey = localStorage.getItem('punchPrivKey');
    el.textContent = savedKey || 'Not stored — only shown on signup';
    privKeyRevealed = true;
  }
}

function closeAccountModal() {
  showScreen('menu');
  send({ type: 'getLobbies' });
}

// =====================================================
//  LOBBY BROWSER
// =====================================================
function showMenu() {
  showScreen('menu');
  send({ type: 'getLobbies' });
}

function updateLobbyList() {
  let container = document.getElementById('lobbyList');
  if (lobbyListData.length === 0) {
    container.innerHTML = '<div class="lobby-empty">No lobbies yet. Create one!</div>';
    return;
  }
  container.innerHTML = lobbyListData.map(l => {
    let isPlaying = l.gameState === 'playing' || l.gameState === 'roundEnd' || l.gameState === 'countdown' || l.gameState === 'matchEnd';
    let isOpen = l.gameState === 'lobby';
    let statusColor = isPlaying ? '#f5c842' : l.currentPlayers >= l.maxPlayers ? '#ff5555' : '#44dd66';
    let statusText = isPlaying ? 'IN GAME' : l.currentPlayers >= l.maxPlayers ? 'FULL' : 'OPEN';
    let feeText = l.entryFee > 0 ? `${SOL_SVG_SM} ${l.entryFee} SOL` : 'FREE';
    let feeColor = l.entryFee > 0 ? '#a0cc60' : '#8a7650';
    let roundInfo = isPlaying && l.roundScores ? ` | R${l.currentRound} (${l.roundScores[1]}-${l.roundScores[2]})` : '';
    let specCount = l.spectatorCount || 0;

    let buttons = '';
    if (isOpen && l.currentPlayers < l.maxPlayers) {
      buttons = `<button class="btn small gold" style="margin:4px 0 0;padding:6px 16px;font-size:10px;" onclick="event.stopPropagation();doJoinLobby('${l.id}')">JOIN</button>`;
    }
    if (isPlaying) {
      buttons = `<button class="btn small secondary" style="margin:4px 0 0;padding:6px 16px;font-size:10px;" onclick="event.stopPropagation();doSpectateLobby('${l.id}')">WATCH</button>`;
    }

    return `<div class="lobby-card">
      <div class="lc-left">
        <div class="lc-mode">${l.mode}</div>
        <div>
          <div class="lc-name">${l.name}</div>
          <div class="lc-host">by ${l.createdBy} <span style="color:${feeColor};font-size:11px;font-family:'Bungee',cursive;">${feeText}</span>${roundInfo}</div>
        </div>
      </div>
      <div style="text-align:right;">
        <div class="lc-players">${l.currentPlayers}/${l.maxPlayers}${specCount > 0 ? ` <span style="color:#8a7650;font-size:11px;">+${specCount} watching</span>` : ''}</div>
        <div class="lc-status" style="color:${statusColor}">${statusText}</div>
        ${buttons}
      </div>
    </div>`;
  }).join('');
}

// =====================================================
//  CREATE LOBBY
// =====================================================
function showCreateLobby() { showScreen('createLobby'); }

function selectMode(el) {
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  selectedMode = el.dataset.mode;
}

function selectEntryFee(el) {
  document.querySelectorAll('.fee-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  selectedEntryFee = parseFloat(el.dataset.fee);
}

function doCreateLobby() {
  if (!currentUser) return;
  let name = document.getElementById('lobbyNameInput').value.trim() || (currentUser.username + "'s Lobby");
  send({ type: 'createLobby', mode: selectedMode, name, entryFee: selectedEntryFee });
}

// =====================================================
//  JOIN / LEAVE / READY
// =====================================================
function doJoinLobby(lobbyId) {
  if (!currentUser) return;
  send({ type: 'joinLobby', lobbyId });
}

function doLeaveLobby() {
  if (isSpectating) {
    send({ type: 'stopSpectating' });
    isSpectating = false;
  } else {
    send({ type: 'leaveLobby' });
  }
  currentLobbyId = null;
  myPlayerId = null;
  serverState = null;
  isRoundOver = false;
  isMatchOver = false;
  showMenu();
}

function doSpectateLobby(lobbyId) {
  if (!currentUser) return;
  isSpectating = true;
  send({ type: 'spectateLobby', lobbyId });
}

function doReady() {
  initAudio();
  send({ type: 'ready' });
}

// =====================================================
//  DEPOSIT / WITHDRAW
// =====================================================
let depositPollTimer = null;

async function showDeposit() {
  showScreen('deposit');
  document.getElementById('depositBalance').textContent = (currentUser?.balance || 0).toFixed(4);
  document.getElementById('depositStatus').textContent = '';
  document.getElementById('depositStatus').style.color = '#f5c842';

  // Fetch user's internal deposit address
  try {
    let res = await fetch(SERVER_URL + '/api/deposit-address', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUser.id }),
    });
    if (!res.ok) throw new Error('Failed to load deposit address');
    let data = await res.json();
    if (data.depositAddress) {
      document.getElementById('depositWalletAddr').textContent = data.depositAddress;
      if (data.onChainBalance > 0) {
        document.getElementById('depositOnChain').textContent = `On-chain balance: ${data.onChainBalance.toFixed(6)} SOL`;
      } else {
        document.getElementById('depositOnChain').textContent = '';
      }
    }
  } catch (e) {
    document.getElementById('depositWalletAddr').textContent = currentUser.public_key || 'Error loading';
  }
}

function showWithdraw() {
  showScreen('withdraw');
  document.getElementById('withdrawBalance').textContent = (currentUser?.balance || 0).toFixed(4);
}


function startDepositPoll() {
  stopDepositPoll();
  let statusEl = document.getElementById('depositStatus');
  let attempts = 0;
  depositPollTimer = setInterval(async () => {
    attempts++;
    if (attempts > 60) { // 2 minutes max
      stopDepositPoll();
      statusEl.textContent = 'Timeout waiting for deposit. Try clicking "Check Deposit".';
      statusEl.style.color = '#ff5555';
      return;
    }
    try {
      let res = await fetch(SERVER_URL + '/api/deposit-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.id }),
      });
      if (!res.ok) { console.log('Poll: non-OK response', res.status); return; }
      let data = await res.json();
      if (data.swept) {
        stopDepositPoll();
        currentUser.balance = data.balance;
        localStorage.setItem('punchUser', JSON.stringify(currentUser));
        updateUserInfoBar();
        statusEl.textContent = `Deposited ${data.amount.toFixed(6)} SOL! New balance: ${data.balance.toFixed(4)} SOL`;
        statusEl.style.color = '#44dd66';
        document.getElementById('depositBalance').textContent = data.balance.toFixed(4);
        document.getElementById('depositOnChain').textContent = '';
      } else if (data.onChainBalance > 0) {
        statusEl.textContent = `Detected ${data.onChainBalance.toFixed(6)} SOL on-chain. Sweeping to treasury...`;
        statusEl.style.color = '#f5c842';
      } else {
        statusEl.textContent = `Waiting for SOL to arrive... (${attempts}s)`;
      }
    } catch (e) {
      console.log('Poll error:', e.message);
    }
  }, 2000);
}

function stopDepositPoll() {
  if (depositPollTimer) { clearInterval(depositPollTimer); depositPollTimer = null; }
}

async function doDepositCheck() {
  if (!currentUser) return;
  let statusEl = document.getElementById('depositStatus');
  statusEl.textContent = 'Checking for deposit...';
  statusEl.style.color = '#f5c842';
  try {
    let res = await fetch(SERVER_URL + '/api/deposit-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUser.id }),
    });
    let data = await res.json();
    if (!res.ok) {
      statusEl.textContent = 'Error: ' + (data.error || 'Check failed');
      statusEl.style.color = '#ff5555';
      return;
    }
    if (data.swept) {
      currentUser.balance = data.balance;
      localStorage.setItem('punchUser', JSON.stringify(currentUser));
      updateUserInfoBar();
      statusEl.textContent = `Deposited ${data.amount.toFixed(6)} SOL! New balance: ${data.balance.toFixed(4)} SOL`;
      statusEl.style.color = '#44dd66';
      document.getElementById('depositBalance').textContent = data.balance.toFixed(4);
      document.getElementById('depositOnChain').textContent = '';
    } else {
      statusEl.textContent = data.message || 'No deposit detected. Send SOL to the address above first.';
      statusEl.style.color = data.onChainBalance > 0 ? '#f5c842' : '#ff5555';
      if (data.onChainBalance > 0) {
        document.getElementById('depositOnChain').textContent = `On-chain: ${data.onChainBalance.toFixed(6)} SOL`;
      }
    }
  } catch (e) {
    statusEl.textContent = 'Error: ' + e.message;
    statusEl.style.color = '#ff5555';
  }
}

async function doWithdraw() {
  if (!currentUser) return;
  let amount = parseFloat(document.getElementById('withdrawAmount').value);
  if (!amount || amount <= 0) { alert('Enter a valid amount'); return; }

  let statusEl = document.getElementById('withdrawStatus');
  statusEl.textContent = 'Processing withdrawal...';
  statusEl.style.color = '#f5c842';

  try {
    let res = await fetch(SERVER_URL + '/api/withdraw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUser.id, amount }),
    });
    let data = await res.json();
    if (data.success) {
      currentUser.balance = data.balance;
      localStorage.setItem('punchUser', JSON.stringify(currentUser));
      updateUserInfoBar();
      statusEl.textContent = `Withdrew ${amount} SOL! New balance: ${data.balance.toFixed(4)} SOL${data.txSignature ? ' | Tx: ' + data.txSignature.slice(0,12) + '...' : ''}`;
      statusEl.style.color = '#44dd66';
      document.getElementById('withdrawBalance').textContent = data.balance.toFixed(4);
      document.getElementById('withdrawAmount').value = '';
    } else {
      statusEl.textContent = data.error || 'Withdrawal failed';
      statusEl.style.color = '#ff5555';
    }
  } catch (e) {
    statusEl.textContent = 'Error: ' + e.message;
    statusEl.style.color = '#ff5555';
  }
}

// =====================================================
//  LEADERBOARD
// =====================================================
async function showLeaderboard() {
  showScreen('leaderboard');
  document.getElementById('leaderboardContent').innerHTML = '<div style="color:#aaa;padding:20px;">Loading...</div>';
  try {
    let res = await fetch(SERVER_URL + '/api/leaderboard');
    let data = await res.json();
    let lb = data.leaderboard || [];
    if (lb.length === 0) {
      document.getElementById('leaderboardContent').innerHTML = '<div style="color:#666;padding:30px;">No players yet!</div>';
      return;
    }
    let medals = ['🥇','🥈','🥉'];
    let html = '<table class="leaderboard-table"><thead><tr><th>#</th><th>Player</th><th>Wins</th><th>Losses</th><th>Kills</th><th>Rating</th><th>Prize</th></tr></thead><tbody>';
    lb.forEach((p, i) => {
      let rowClass = i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';
      let medal = i < 3 ? medals[i] : (i + 1);
      let prize = i < 3 ? '<span class="lb-prize">1 SOL</span>' : '-';
      html += `<tr class="${rowClass}"><td>${medal}</td><td>${p.username}</td><td>${p.total_wins}</td><td>${p.total_losses}</td><td>${p.total_kills}</td><td>${p.rating}</td><td>${prize}</td></tr>`;
    });
    html += '</tbody></table>';
    document.getElementById('leaderboardContent').innerHTML = html;
  } catch(e) {
    document.getElementById('leaderboardContent').innerHTML = '<div style="color:#ff5555;">Error loading leaderboard</div>';
  }
}

// =====================================================
//  GAME HISTORY
// =====================================================
async function showHistory() {
  if (!currentUser) return;
  showScreen('history');
  document.getElementById('historyContent').innerHTML = '<div style="color:#aaa;padding:20px;">Loading...</div>';
  try {
    let res = await fetch(`${SERVER_URL}/api/history/${currentUser.id}`);
    let data = await res.json();
    let hist = data.history || [];
    if (hist.length === 0) {
      document.getElementById('historyContent').innerHTML = '<div style="color:#666;padding:30px;">No games played yet!</div>';
      return;
    }
    let html = '<table class="history-table"><thead><tr><th>Date</th><th>Mode</th><th>Team</th><th>Result</th><th>Kills</th><th>Damage</th><th>Rating</th></tr></thead><tbody>';
    hist.forEach(g => {
      let dateStr = new Date(g.played_at).toLocaleDateString();
      let result = g.won ? '<span style="color:#44dd66">WIN</span>' : '<span style="color:#ff5555">LOSS</span>';
      let rc = g.rating_change >= 0 ? `<span style="color:#44dd66">+${g.rating_change}</span>` : `<span style="color:#ff5555">${g.rating_change}</span>`;
      html += `<tr><td>${dateStr}</td><td>${g.mode}</td><td>Team ${g.team}</td><td>${result}</td><td>${g.kills}</td><td>${g.damage_dealt}</td><td>${rc}</td></tr>`;
    });
    html += '</tbody></table>';
    document.getElementById('historyContent').innerHTML = html;
  } catch(e) {
    document.getElementById('historyContent').innerHTML = '<div style="color:#ff5555;">Error loading history</div>';
  }
}

// =====================================================
//  WEBSOCKET CONNECTION
// =====================================================
function connect() {
  let wsUrl;
  if (SERVER_URL) {
    // Production: connect to external server via wss
    let url = new URL(SERVER_URL);
    let protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    wsUrl = `${protocol}//${url.host}`;
  } else {
    // Local dev: same origin
    let protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let host = window.location.hostname || 'localhost';
    let port = window.location.port || '3000';
    wsUrl = `${protocol}//${host}:${port}`;
  }
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    connected = true;
    document.getElementById('connStatus').textContent = 'Connected';
    document.getElementById('connStatus').classList.add('connected');
    if (currentUser) {
      send({ type: 'auth', userId: currentUser.id, username: currentUser.username });
      send({ type: 'getLobbies' });
      send({ type: 'getTreasuryAddress' });
    }
  };

  ws.onmessage = (event) => {
    let msg = JSON.parse(event.data);

    if (msg.type === 'welcome') {
      myVisitorId = msg.visitorId;
      initAudio();
    }
    if (msg.type === 'lobbyList') {
      lobbyListData = msg.lobbies || [];
      if (currentScreen === 'menu') updateLobbyList();
    }
    if (msg.type === 'lobbyCreated') {
      send({ type: 'joinLobby', lobbyId: msg.lobbyId });
    }
    if (msg.type === 'joinedLobby') {
      currentLobbyId = msg.lobbyId;
      myPlayerId = msg.playerId;
      isSpectating = false;
      showScreen('inLobby');
      refreshUserData();
    }
    if (msg.type === 'spectating') {
      currentLobbyId = msg.lobbyId;
      myPlayerId = null;
      isSpectating = true;
      showScreen('spectating');
    }
    if (msg.type === 'treasuryAddress') {
      treasuryAddress = msg.address;
    }
    if (msg.type === 'gameState') {
      handleGameState(msg);
    }
    if (msg.type === 'lobbyFinished') {
      currentLobbyId = null;
      myPlayerId = null;
      serverState = null;
      isSpectating = false;
      isRoundOver = false;
      isMatchOver = false;
      refreshUserData();
      setTimeout(() => showMenu(), 2000);
    }
    if (msg.type === 'error') {
      alert(msg.msg);
    }
  };

  ws.onclose = () => {
    connected = false;
    document.getElementById('connStatus').textContent = 'Disconnected — Reconnecting...';
    document.getElementById('connStatus').classList.remove('connected');
    setTimeout(connect, 2000);
  };
  ws.onerror = () => {};
}

function send(data) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

async function refreshUserData() {
  if (!currentUser) return;
  try {
    let res = await fetch(SERVER_URL + '/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUser.username }),
    });
    let data = await res.json();
    if (data.user) { currentUser = data.user; localStorage.setItem('punchUser', JSON.stringify(currentUser)); }
  } catch(e) {}
}

// =====================================================
//  HANDLE GAME STATE FROM SERVER
// =====================================================
function handleGameState(state) {
  let prevGs = serverState ? serverState.gameState : null;
  serverState = state;

  if (prevGs !== state.gameState) {
    if (state.gameState === 'countdown') {
      // Reset round/match guards when transitioning to countdown
      isRoundOver = false;
      isMatchOver = false;
      lastCountdown = state.countdownTimer;
      if (!isSpectating) showScreen('countdown');
      document.getElementById('countdownText').textContent = state.countdownTimer;
      playSound('countdown');
    }
    if (state.gameState === 'playing' && prevGs === 'countdown') {
      isRoundOver = false;
      isMatchOver = false;
      playSound('countdown');
      if (isSpectating) showScreen('spectating');
      else showScreen('playing');
    }
    if (state.gameState === 'roundEnd' && !isRoundOver) {
      isRoundOver = true;
      showScreen('roundEnd');
      updateRoundEnd(state);
      // Play round win/loss sound exactly once
      if (!isSpectating) {
        let me = state.players[myPlayerId];
        if (me && state.winnerTeam && me.team === state.winnerTeam) playSound('win');
        else playSound('hurt');
      }
    }
    if (state.gameState === 'matchEnd' && !isMatchOver) {
      isMatchOver = true;
      showScreen('matchEnd');
      updateMatchEnd(state);
      if (!isSpectating) {
        let me = state.players[myPlayerId];
        if (me && state.matchWinnerTeam && me.team === state.matchWinnerTeam) playSound('win');
        else playSound('hurt');
      }
    }
    if (state.gameState === 'lobby') {
      isRoundOver = false;
      isMatchOver = false;
      if (currentScreen === 'playing' || currentScreen === 'countdown' || currentScreen === 'roundEnd' || currentScreen === 'spectating') {
        if (!isSpectating) showScreen('inLobby');
      }
    }
  }

  if (state.gameState === 'countdown' && state.countdownTimer !== lastCountdown) {
    lastCountdown = state.countdownTimer;
    document.getElementById('countdownText').textContent = state.countdownTimer;
    playSound('countdown');
  }

  // Only process particles during active gameplay to prevent audio loops during roundEnd/matchEnd
  if (state.gameState === 'playing' && state.particles) {
    for (let p of state.particles) {
      if (p.type === 'hit') {
        spawnParticles(p.x, p.y, p.big ? 15 : 8, p.big ? '#ff4400' : '#ffcc00', 'star');
        addFloatingText(p.x, p.y - 30, p.big ? 'SUPER!' : 'POW!', p.big ? '#ff4400' : '#ffcc00', p.big ? 24 : 18);
        playSound('hit');
        if (isMyPlayer(p)) { shakeTimer = 0.15; shakeIntensity = 5; }
      } else if (p.type === 'shieldHit') {
        spawnParticles(p.x, p.y, 6, '#66ccff', 'hit');
        addFloatingText(p.x, p.y - 30, 'Blocked!', '#66ccff', 16);
      } else if (p.type === 'kill') {
        spawnParticles(p.x, p.y, 20, '#ff6600', 'star');
        addFloatingText(p.x, p.y - 40, p.name, '#ff4444', 22);
        addFloatingText(p.x, p.y - 65, `by ${p.killerName}`, '#ffcc44', 16);
        playSound('kill');
        shakeTimer = 0.3; shakeIntensity = 8;
      }
    }
  }

  if (state.gameState === 'lobby' && currentScreen === 'inLobby') updateInLobby(state);

  // Spectators see the game being played
  if (isSpectating && (state.gameState === 'playing' || state.gameState === 'countdown')) {
    if (currentScreen !== 'spectating' && currentScreen !== 'roundEnd' && currentScreen !== 'matchEnd') {
      showScreen('spectating');
    }
  }
}

function isMyPlayer(p) {
  if (!serverState || !myPlayerId) return false;
  let me = serverState.players[myPlayerId];
  if (!me) return false;
  let dx = me.x - p.x, dy = me.y - p.y;
  return Math.sqrt(dx*dx + dy*dy) < 60;
}

// =====================================================
//  IN-LOBBY WAITING ROOM
// =====================================================
function updateInLobby(state) {
  document.getElementById('inLobbyTitle').textContent = state.lobbyName || 'Lobby';
  let feeText = state.entryFee > 0 ? ` | Entry: ${SOL_SVG_SM} ${state.entryFee} SOL` : ' | FREE';
  let poolText = state.prizePool > 0 ? ` | Pool: ${SOL_SVG_SM} ${state.prizePool} SOL` : '';
  document.getElementById('inLobbyMode').innerHTML = `Mode: <b>${state.mode}</b> | Best of 5 | ${Object.keys(state.players).length}/${state.maxPlayers} players${feeText}${poolText}`;

  let emojis = ['🐵','🙈','🐒','🦧','🐻','🦊'];
  let t1Html = '', t2Html = '';
  for (let p of Object.values(state.players)) {
    let isYou = p.id === myPlayerId;
    let cls = 'lobby-player' + (p.ready ? ' ready' : '') + (isYou ? ' you' : '') + ` team${p.team}`;
    let card = `<div class="${cls}">
      <div class="lp-emoji">${emojis[p.slot % emojis.length]}</div>
      <div class="lp-name" style="color:${p.color}">${p.name}${isYou ? ' (You)' : ''}</div>
      <div class="lp-status" style="color:${p.ready ? '#44cc66' : '#aaa'}">${p.ready ? 'Ready' : 'Not Ready'}</div>
    </div>`;
    if (p.team === 1) t1Html += card; else t2Html += card;
  }
  document.getElementById('team1Players').innerHTML = t1Html || '<div style="color:#555;font-size:13px;padding:10px;">Waiting...</div>';
  document.getElementById('team2Players').innerHTML = t2Html || '<div style="color:#555;font-size:13px;padding:10px;">Waiting...</div>';

  let pArr = Object.values(state.players);
  let count = pArr.length, readyCount = pArr.filter(p => p.ready).length;
  let info = document.getElementById('inLobbyInfo');
  if (count < state.maxPlayers) info.textContent = `${count}/${state.maxPlayers} players — Waiting for more...`;
  else if (readyCount < count) info.textContent = `${readyCount}/${count} ready — Waiting for everyone...`;
  else info.textContent = 'All ready! Starting soon...';

  let btn = document.getElementById('readyBtn');
  let me = state.players[myPlayerId];
  if (me) {
    btn.textContent = me.ready ? 'Ready!' : 'Ready Up';
    btn.className = me.ready ? 'btn ready' : 'btn';
  }
}

// =====================================================
//  ROUND END
// =====================================================
function updateRoundEnd(state) {
  let wt = state.winnerTeam;
  let rs = state.roundScores || {1:0, 2:0};
  document.getElementById('winnerEmoji').textContent = wt ? '👑' : '💀';
  document.getElementById('winnerTitle').textContent = wt ? `${teamNameFull(wt)} wins Round ${state.currentRound}!` : 'Draw!';
  document.getElementById('winnerTitle').style.color = wt === 1 ? '#ff6644' : wt === 2 ? '#44aaff' : '#ffcc44';
  document.getElementById('winnerSubtitle').textContent = `Score: Punch [${rs[1]}] - [${rs[2]}] Lulu | Next round in ${state.roundEndTimer}s...`;

  let sb = document.getElementById('scoreboard');
  let pArr = Object.values(state.players).sort((a, b) => b.kills - a.kills);
  sb.innerHTML = `<div style="font-family:Bungee;color:#ffcc44;font-size:16px;margin-bottom:6px">Round ${state.currentRound} of 5 | Score: ${rs[1]} - ${rs[2]}</div>` +
    pArr.map(p => {
      let tc = p.team === 1 ? '#ff6644' : '#44aaff';
      return `<div style="display:flex;gap:20px;justify-content:center;padding:3px 0;color:${p.id===myPlayerId?'#fff':'#aaa'};font-size:14px;">
        <span style="color:${tc};font-size:11px;min-width:50px;">${teamNameFull(p.team)}</span>
        <span style="color:${p.color};font-family:Bungee;min-width:80px">${p.name}</span>
        <span>${p.kills} kills</span>
        <span>${p.damageDealt} dmg</span>
        <span>${p.alive?'Alive':'Dead'}</span>
      </div>`;
    }).join('');
}

function updateMatchEnd(state) {
  let mwt = state.matchWinnerTeam;
  let rs = state.roundScores || {1:0, 2:0};
  let el = document.getElementById('matchEndScreen');
  if (!el) return;
  let prizeText = state.prizePool > 0 ? `Prize Pool: ${SOL_SVG} ${state.prizePool} SOL` : '';
  el.querySelector('.match-emoji').textContent = '🏆';
  el.querySelector('.match-title').textContent = mwt ? `${teamNameFull(mwt)} Wins the Match!` : 'Match Over!';
  el.querySelector('.match-title').style.color = mwt === 1 ? '#ff6644' : mwt === 2 ? '#44aaff' : '#ffcc44';
  el.querySelector('.match-subtitle').textContent = `Final Score: Punch [${rs[1]}] - [${rs[2]}] Lulu`;
  el.querySelector('.match-prize').innerHTML = prizeText;

  let sb = el.querySelector('.match-scoreboard');
  let pArr = Object.values(state.players).sort((a, b) => b.kills - a.kills);
  sb.innerHTML = pArr.map(p => {
    let tc = p.team === 1 ? '#ff6644' : '#44aaff';
    let isWinner = p.team === mwt;
    return `<div style="display:flex;gap:20px;justify-content:center;padding:3px 0;color:${isWinner?'#fff':'#888'};font-size:14px;">
      <span style="color:${tc};font-size:11px;min-width:50px;">${teamNameFull(p.team)}</span>
      <span style="color:${p.color};font-family:Bungee;min-width:80px">${p.name}</span>
      <span>${p.kills} kills</span>
      <span>${p.damageDealt} dmg</span>
      <span>${isWinner?'🏆':''}</span>
    </div>`;
  }).join('');
}

// =====================================================
//  INPUT HANDLING
// =====================================================
document.addEventListener('keydown', (e) => {
  if (keys[e.code]) return;
  keys[e.code] = true;
  if (serverState && serverState.gameState === 'playing' && !isSpectating) {
    if (e.code === 'Space') { e.preventDefault(); send({ type: 'input', punch: true }); playSound('punch'); }
    if (e.code === 'KeyQ') { send({ type: 'input', punch: true, superPunch: true }); playSound('punch'); }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { e.preventDefault(); send({ type: 'input', dash: true }); playSound('dash'); }
    if (e.code === 'KeyE') { send({ type: 'input', shield: true }); }
    if (e.code === 'KeyF') { send({ type: 'input', plushieThrow: true }); playSound('throw'); }
  }
  if (e.code === 'Enter' && currentScreen === 'auth') doAuth();
  if (e.code === 'Escape' && isSpectating) doLeaveLobby();
  sendMovementState();
});

document.addEventListener('keyup', (e) => { keys[e.code] = false; sendMovementState(); });

canvas.addEventListener('mousemove', (e) => {
  let rect = canvas.getBoundingClientRect();
  mouseX = (e.clientX - rect.left) * (W / rect.width);
  mouseY = (e.clientY - rect.top) * (H / rect.height);
  sendAim();
});

canvas.addEventListener('click', (e) => {
  initAudio();
  if (serverState && serverState.gameState === 'playing' && !isSpectating) {
    let rect = canvas.getBoundingClientRect();
    mouseX = (e.clientX - rect.left) * (W / rect.width);
    mouseY = (e.clientY - rect.top) * (H / rect.height);
    sendAim();
    send({ type: 'input', punch: true });
    playSound('punch');
  }
});

function sendMovementState() {
  if (!serverState || serverState.gameState !== 'playing' || isSpectating) return;
  send({
    type: 'input',
    up: !!(keys['KeyW'] || keys['ArrowUp']),
    down: !!(keys['KeyS'] || keys['ArrowDown']),
    left: !!(keys['KeyA'] || keys['ArrowLeft']),
    right: !!(keys['KeyD'] || keys['ArrowRight']),
  });
}

function sendAim() {
  if (!serverState || !myPlayerId || isSpectating) return;
  let me = serverState.players[myPlayerId];
  if (!me) return;
  send({ type: 'input', aimAngle: Math.atan2(mouseY - me.y, mouseX - me.x) });
}

// =====================================================
//  PARTICLES & FLOATING TEXT
// =====================================================
function spawnParticles(x, y, count, color, type) {
  for (let i = 0; i < count; i++) {
    let a = Math.random() * Math.PI * 2, s = Math.random() * 4 + 1;
    particles.push({ x, y, vx: Math.cos(a)*s, vy: Math.sin(a)*s-1, life: 1, decay: 0.025+Math.random()*0.02, size: Math.random()*6+2, color: color||'#ffaa00', type: type||'hit', rot: Math.random()*Math.PI*2, rotSpeed: (Math.random()-0.5)*0.2 });
  }
}
function addFloatingText(x, y, text, color, size) {
  floatingTexts.push({ x, y, text, color: color||'#fff', size: size||20, vy: -2, life: 1, decay: 0.025 });
}

// =====================================================
//  DRAWING — BACKGROUND
// =====================================================
function drawBackground() {
  let grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#1a3a2a'); grad.addColorStop(0.3, '#2d5a3d');
  grad.addColorStop(0.6, '#4a7a44'); grad.addColorStop(1, '#6b8a3a');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);

  for (let i = 0; i < 10; i++) drawBgTree(80+i*160, 60+Math.sin(i*1.5)*30, 0.5+Math.sin(i)*0.15, 0.35);

  let gg = ctx.createLinearGradient(0, H-150, 0, H);
  gg.addColorStop(0, '#5a9a44'); gg.addColorStop(0.5, '#4a8a34'); gg.addColorStop(1, '#3a7a24');
  ctx.fillStyle = gg; ctx.beginPath(); ctx.moveTo(0, H-120);
  for (let x = 0; x <= W; x += 40) ctx.lineTo(x, H-120+Math.sin(x*0.015+localTime*0.5)*10);
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();

  ctx.strokeStyle = 'rgba(139,119,101,0.2)'; ctx.lineWidth = 3;
  for (let i = 0; i < 22; i++) { let fx=30+i*75; ctx.beginPath(); ctx.moveTo(fx,100); ctx.lineTo(fx,160); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(20,120); ctx.lineTo(W-20,120); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(20,150); ctx.lineTo(W-20,150); ctx.stroke();

  ctx.strokeStyle = 'rgba(255,200,100,0.15)'; ctx.lineWidth = 4; ctx.strokeRect(20,20,W-40,H-40);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(W/2,H/2,120,0,Math.PI*2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W/2,30); ctx.lineTo(W/2,H-30); ctx.stroke();
}

function drawBgTree(x, y, scale, alpha) {
  ctx.save(); ctx.translate(x,y); ctx.scale(scale,scale); ctx.globalAlpha = alpha||0.5;
  ctx.fillStyle = '#5a4a2a'; ctx.fillRect(-10,20,20,80);
  ctx.fillStyle = '#284028'; ctx.beginPath(); ctx.arc(0,0,50,0,Math.PI*2); ctx.fill();
  ctx.fillStyle = '#327832'; ctx.beginPath(); ctx.arc(-20,-15,35,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(20,-10,38,0,Math.PI*2); ctx.fill();
  ctx.restore();
}

// =====================================================
//  DRAWING — PLAYER
// =====================================================
function drawPlayer(p, isMe) {
  ctx.save();
  if (p.invincible && Math.floor(localTime*10)%2===0) ctx.globalAlpha = 0.5;
  if (p.dashing) ctx.globalAlpha = 0.7;
  if (!p.alive) ctx.globalAlpha = 0.25;

  ctx.translate(p.x, p.y); ctx.scale(p.facing, 1);
  let bs = 0.65; ctx.scale(bs, bs);
  let bob = Math.sin(localTime*6+(p.slot||0))*2;
  let wb = p.alive ? Math.sin(localTime*14+(p.slot||0))*3 : 0;
  let la = p.facing===1 ? p.aimAngle : Math.PI-p.aimAngle;
  let lx = Math.cos(la)*2.5, ly = Math.sin(la)*2;

  if (p.dashing) { ctx.globalAlpha=0.3; ctx.fillStyle='#88ddff'; ctx.beginPath(); ctx.ellipse(0,5,24,28,0,0,Math.PI*2); ctx.fill(); ctx.globalAlpha=1; }
  ctx.fillStyle='rgba(0,0,0,0.2)'; ctx.beginPath(); ctx.ellipse(0,28,22,6,0,0,Math.PI*2); ctx.fill();
  if (p.shieldActive) { ctx.strokeStyle='rgba(100,200,255,0.6)'; ctx.lineWidth=4; ctx.beginPath(); ctx.arc(0,0,52,0,Math.PI*2); ctx.stroke(); ctx.fillStyle='rgba(100,200,255,0.12)'; ctx.fill(); }

  let isT2 = p.team === 2;

  if (isT2) {
    // ===== LULU TEAM MONKEY — chubbier, star backpack, tuft, pointed ears =====

    // Star backpack (instead of plushie)
    ctx.save(); ctx.translate(-12,-6+bob); ctx.rotate(Math.sin(localTime*3)*0.12);
    ctx.fillStyle='#4488cc';
    ctx.beginPath();
    for (let i=0;i<5;i++) {
      let a1 = -Math.PI/2 + i*Math.PI*2/5, a2 = a1 + Math.PI/5;
      ctx.lineTo(Math.cos(a1)*12, Math.sin(a1)*12);
      ctx.lineTo(Math.cos(a2)*5, Math.sin(a2)*5);
    }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle='#66aaee';
    ctx.beginPath();
    for (let i=0;i<5;i++) {
      let a1 = -Math.PI/2 + i*Math.PI*2/5, a2 = a1 + Math.PI/5;
      ctx.lineTo(Math.cos(a1)*7, Math.sin(a1)*7);
      ctx.lineTo(Math.cos(a2)*3, Math.sin(a2)*3);
    }
    ctx.closePath(); ctx.fill();
    ctx.restore();

    let furMain='#b8956a', furDark='#a0805a', furBelly='#e0c8a8';
    let furNose='#c09070', furMouth='#906050', furMouthOpen='#906050';
    let furEarIn='#d4b898', furBlinkLine='#3a2a1a', pupilColor='#2a1a0a';
    let bc = p.color||furMain;

    // Legs — shorter, wider (chubbier)
    ctx.fillStyle=furDark;
    ctx.beginPath(); ctx.ellipse(-9,20-wb,8,9,0,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(9,20+wb,8,9,0,0,Math.PI*2); ctx.fill();
    // Body — rounder, wider
    ctx.fillStyle=furMain; ctx.beginPath(); ctx.ellipse(0,4+bob,22,22,0,0,Math.PI*2); ctx.fill();
    // Belly — bigger, rounder
    ctx.fillStyle=furBelly; ctx.beginPath(); ctx.ellipse(2,7+bob,14,15,0,0,Math.PI*2); ctx.fill();
    // Shoulder tuft
    ctx.fillStyle=furMain; ctx.beginPath(); ctx.ellipse(0,-6+bob,22,6,0,0,Math.PI*2); ctx.fill();

    // Arms
    let aa = Math.sin(localTime*2+(p.slot||0))*0.1;
    if (p.punching) {
      ctx.save(); ctx.translate(0,-2+bob); ctx.rotate(la);
      ctx.fillStyle=furDark; ctx.beginPath(); ctx.ellipse(18,0,11,8,0,0,Math.PI*2); ctx.fill();
      ctx.fillStyle=furBelly; ctx.beginPath(); ctx.arc(30,0,9,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle = p.usingSuperPunch ? '#ff4400' : '#55bbff'; ctx.lineWidth = p.usingSuperPunch ? 3 : 2;
      for (let i=0;i<3;i++) { let a=-0.4+i*0.4; ctx.beginPath(); ctx.moveTo(36+Math.cos(a)*2,Math.sin(a)*2); ctx.lineTo(36+Math.cos(a)*14,Math.sin(a)*14); ctx.stroke(); }
      ctx.restore();
    } else {
      ctx.fillStyle=furDark; ctx.save(); ctx.translate(18,2+bob); ctx.rotate(aa);
      ctx.beginPath(); ctx.ellipse(4,8,7,10,0,0,Math.PI*2); ctx.fill(); ctx.restore();
    }
    ctx.fillStyle=furDark; ctx.save(); ctx.translate(-18,2+bob); ctx.rotate(-aa-0.3);
    ctx.beginPath(); ctx.ellipse(-4,6,7,10,0,0,Math.PI*2); ctx.fill(); ctx.restore();

    // Head — bigger, rounder
    let ht = Math.sin(la)*0.08;
    ctx.save(); ctx.rotate(ht);
    ctx.fillStyle=furMain; ctx.beginPath(); ctx.ellipse(0,-18+bob,20,19,0,0,Math.PI*2); ctx.fill();
    // Puffy cheeks
    ctx.fillStyle=furBelly; ctx.beginPath(); ctx.ellipse(-8,-12+bob,8,7,0,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(12,-12+bob,8,7,0,0,Math.PI*2); ctx.fill();
    // Face plate
    ctx.fillStyle=furBelly; ctx.beginPath(); ctx.ellipse(3,-14+bob,12,13,0,0,Math.PI*2); ctx.fill();
    // Head tuft — spiky fur on top
    ctx.fillStyle='#a0805a';
    ctx.beginPath(); ctx.moveTo(-4,-36+bob); ctx.lineTo(0,-28+bob); ctx.lineTo(4,-36+bob); ctx.lineTo(6,-28+bob); ctx.lineTo(10,-34+bob); ctx.lineTo(8,-26+bob); ctx.closePath(); ctx.fill();
    ctx.fillStyle=furMain;
    ctx.beginPath(); ctx.moveTo(-2,-33+bob); ctx.lineTo(1,-27+bob); ctx.lineTo(5,-33+bob); ctx.lineTo(7,-27+bob); ctx.lineTo(9,-31+bob); ctx.lineTo(7,-25+bob); ctx.closePath(); ctx.fill();

    // Face stripe
    ctx.fillStyle='#8a6050'; ctx.globalAlpha=0.45;
    ctx.beginPath(); ctx.moveTo(-2,-32+bob); ctx.lineTo(2,-32+bob); ctx.lineTo(3,-10+bob); ctx.lineTo(-3,-10+bob); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = p.alive ? 1 : 0.25;
    if (p.invincible && Math.floor(localTime*10)%2===0) ctx.globalAlpha = 0.5;
    if (p.dashing) ctx.globalAlpha = 0.7;

    // Eyes — bigger, rounder
    let blink = Math.sin(localTime*0.5+(p.slot||0)*2)>0.97;
    if (!blink && p.alive) {
      ctx.fillStyle='#fff';
      ctx.beginPath(); ctx.ellipse(-2,-18+bob,6,6,0,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(10,-18+bob,6,6,0,0,Math.PI*2); ctx.fill();
      ctx.fillStyle=pupilColor;
      ctx.beginPath(); ctx.arc(-2+lx,-18+bob+ly,3,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(10+lx,-18+bob+ly,3,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#fff';
      ctx.beginPath(); ctx.arc(-2+lx*0.3,-19.5+bob+ly*0.3,1.4,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(10+lx*0.3,-19.5+bob+ly*0.3,1.4,0,Math.PI*2); ctx.fill();
      // Angular brows
      ctx.strokeStyle='#6a4030'; ctx.lineWidth=2.5;
      ctx.beginPath(); ctx.moveTo(-7,-24+bob); ctx.lineTo(1,-22.5+bob); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(15,-24+bob); ctx.lineTo(7,-22.5+bob); ctx.stroke();
    } else {
      ctx.strokeStyle=furBlinkLine; ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(-5,-18+bob); ctx.lineTo(1,-18+bob); ctx.moveTo(7,-18+bob); ctx.lineTo(13,-18+bob); ctx.stroke();
    }
    // Nose — wider
    ctx.fillStyle=furNose; ctx.beginPath(); ctx.ellipse(4,-11+bob,4,2.5,0,0,Math.PI*2); ctx.fill();
    // Mouth
    if (p.punching) {
      ctx.fillStyle=furMouthOpen; ctx.beginPath(); ctx.ellipse(4,-6+bob,6,4,0,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#fff'; ctx.fillRect(0,-9+bob,3,2); ctx.fillRect(5,-9+bob,3,2);
    } else {
      ctx.strokeStyle=furMouth; ctx.lineWidth=1.5; ctx.beginPath(); ctx.arc(4,-8+bob,4,0.2,Math.PI-0.2); ctx.stroke();
    }
    // Pointed ears
    ctx.fillStyle=furDark;
    ctx.beginPath(); ctx.moveTo(-18,-14+bob); ctx.lineTo(-24,-32+bob); ctx.lineTo(-12,-22+bob); ctx.closePath(); ctx.fill();
    ctx.fillStyle=furEarIn;
    ctx.beginPath(); ctx.moveTo(-18,-16+bob); ctx.lineTo(-22,-30+bob); ctx.lineTo(-14,-22+bob); ctx.closePath(); ctx.fill();
    ctx.fillStyle=furDark;
    ctx.beginPath(); ctx.moveTo(20,-16+bob); ctx.lineTo(26,-34+bob); ctx.lineTo(14,-24+bob); ctx.closePath(); ctx.fill();
    ctx.fillStyle=furEarIn;
    ctx.beginPath(); ctx.moveTo(20,-18+bob); ctx.lineTo(24,-32+bob); ctx.lineTo(16,-24+bob); ctx.closePath(); ctx.fill();
    ctx.restore();

    // Tail — curly
    ctx.strokeStyle='#a0805a'; ctx.lineWidth=3; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(-16,16); let tw2=Math.sin(localTime*4+(p.slot||0))*10;
    ctx.bezierCurveTo(-30+tw2,12,-34+tw2,-6,-20+tw2,-12); ctx.stroke();

  } else {
    // ===== PUNCH TEAM MONKEY — original warm brown monkey =====

    // Plushie on back
    ctx.save(); ctx.translate(-14,-8+bob); ctx.rotate(Math.sin(localTime*3)*0.1);
    ctx.fillStyle='#cc5500'; ctx.beginPath(); ctx.ellipse(0,0,12,14,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#ee8833'; ctx.beginPath(); ctx.ellipse(0,-4,8,8,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#222'; ctx.beginPath(); ctx.arc(-3,-5,1.5,0,Math.PI*2); ctx.arc(3,-5,1.5,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#bb6622'; ctx.beginPath(); ctx.ellipse(0,-1,4,3,0,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='#cc5500'; ctx.lineWidth=4; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(-10,2); ctx.lineTo(-16,8); ctx.moveTo(10,2); ctx.lineTo(16,8); ctx.stroke();
    ctx.restore();

    let furMain='#d4a574', furDark='#c4956a', furBelly='#e8c9a0';
    let bc = p.color||furMain;

    // Legs
    ctx.fillStyle=furDark;
    ctx.beginPath(); ctx.ellipse(-8,20-wb,7,10,0,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(8,20+wb,7,10,0,0,Math.PI*2); ctx.fill();
    // Body
    ctx.fillStyle=furMain; ctx.beginPath(); ctx.ellipse(0,4+bob,18,22,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle=furBelly; ctx.beginPath(); ctx.ellipse(2,8+bob,11,14,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = bc; ctx.beginPath(); ctx.ellipse(0,-4+bob,20,5,0,0,Math.PI*2); ctx.fill();

    // Arms
    let aa = Math.sin(localTime*2+(p.slot||0))*0.1;
    if (p.punching) {
      ctx.save(); ctx.translate(0,-2+bob); ctx.rotate(la);
      ctx.fillStyle=furDark; ctx.beginPath(); ctx.ellipse(18,0,10,7,0,0,Math.PI*2); ctx.fill();
      ctx.fillStyle=furBelly; ctx.beginPath(); ctx.arc(28,0,8,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle = p.usingSuperPunch ? '#ff4400' : '#ffaa00'; ctx.lineWidth = p.usingSuperPunch ? 3 : 2;
      for (let i=0;i<3;i++) { let a=-0.4+i*0.4; ctx.beginPath(); ctx.moveTo(34+Math.cos(a)*2,Math.sin(a)*2); ctx.lineTo(34+Math.cos(a)*14,Math.sin(a)*14); ctx.stroke(); }
      ctx.restore();
    } else {
      ctx.fillStyle=furDark; ctx.save(); ctx.translate(16,2+bob); ctx.rotate(aa);
      ctx.beginPath(); ctx.ellipse(4,8,6,10,0,0,Math.PI*2); ctx.fill(); ctx.restore();
    }
    ctx.fillStyle=furDark; ctx.save(); ctx.translate(-16,2+bob); ctx.rotate(-aa-0.3);
    ctx.beginPath(); ctx.ellipse(-4,6,6,10,0,0,Math.PI*2); ctx.fill(); ctx.restore();

    // Head
    let ht = Math.sin(la)*0.08;
    ctx.save(); ctx.rotate(ht);
    ctx.fillStyle=furMain; ctx.beginPath(); ctx.ellipse(0,-18+bob,18,17,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle=furBelly; ctx.beginPath(); ctx.ellipse(3,-14+bob,12,12,0,0,Math.PI*2); ctx.fill();

    // Eyes
    let blink = Math.sin(localTime*0.5+(p.slot||0)*2)>0.97;
    if (!blink && p.alive) {
      ctx.fillStyle='#fff';
      ctx.beginPath(); ctx.ellipse(-1,-18+bob,5,5.5,0,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(9,-18+bob,5,5.5,0,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#2a1a0a';
      ctx.beginPath(); ctx.arc(-1+lx,-18+bob+ly,2.5,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(9+lx,-18+bob+ly,2.5,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#fff';
      ctx.beginPath(); ctx.arc(-1+lx*0.3,-19.5+bob+ly*0.3,1.2,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(9+lx*0.3,-19.5+bob+ly*0.3,1.2,0,Math.PI*2); ctx.fill();
    } else {
      ctx.strokeStyle='#3a2a1a'; ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(-3,-18+bob); ctx.lineTo(1,-18+bob); ctx.moveTo(7,-18+bob); ctx.lineTo(11,-18+bob); ctx.stroke();
    }
    // Nose + Mouth
    ctx.fillStyle='#b08060'; ctx.beginPath(); ctx.ellipse(4,-12+bob,3,2,0,0,Math.PI*2); ctx.fill();
    if (p.punching) {
      ctx.fillStyle='#a05030'; ctx.beginPath(); ctx.ellipse(4,-7+bob,5,3,0,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#fff'; ctx.fillRect(1,-9+bob,2,2); ctx.fillRect(5,-9+bob,2,2);
    } else {
      ctx.strokeStyle='#a07050'; ctx.lineWidth=1.5; ctx.beginPath(); ctx.arc(4,-9+bob,3,0.2,Math.PI-0.2); ctx.stroke();
    }
    // Round ears
    ctx.fillStyle=furDark; ctx.beginPath(); ctx.arc(-16,-18+bob,6,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#edb'; ctx.beginPath(); ctx.arc(-16,-18+bob,3,0,Math.PI*2); ctx.fill();
    ctx.fillStyle=furDark; ctx.beginPath(); ctx.arc(18,-20+bob,6,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#edb'; ctx.beginPath(); ctx.arc(18,-20+bob,3,0,Math.PI*2); ctx.fill();
    ctx.restore();

    // Tail — regular curve
    ctx.strokeStyle=furDark; ctx.lineWidth=3; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(-14,16); let tw=Math.sin(localTime*4+(p.slot||0))*8;
    ctx.quadraticCurveTo(-28+tw,10,-24+tw,-2); ctx.stroke();
  }
  ctx.restore();

  // Name + HP + Team
  ctx.save(); ctx.translate(p.x, p.y);
  let tc = p.team===1?'#ff6644':'#44aaff';
  ctx.font="bold 10px 'Nunito',sans-serif"; ctx.textAlign='center'; ctx.fillStyle=tc;
  ctx.fillText(teamNameFull(p.team), 0, -50);

  ctx.font="bold 13px 'Bungee',cursive"; ctx.strokeStyle='rgba(0,0,0,0.6)'; ctx.lineWidth=3;
  let nt = p.name + (p.id===myPlayerId?' (You)':'');
  ctx.strokeText(nt,0,-38); ctx.fillStyle=p.color; ctx.fillText(nt,0,-38);

  if (p.alive) {
    let bw=44,bh=5,bx=-bw/2,by=-30;
    ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(bx-1,by-1,bw+2,bh+2);
    let hp=p.hp/100;
    ctx.fillStyle = hp>0.5?'#44cc44':hp>0.25?'#cccc44':'#cc4444';
    ctx.fillRect(bx,by,bw*hp,bh);
  }
  if (p.superPunchReady) { ctx.font='12px Arial'; ctx.fillStyle='#ff4400'; ctx.fillText('Q',0,-58); }
  ctx.restore();
}

// =====================================================
//  DRAWING — PROJECTILES
// =====================================================
function drawProjectile(proj) {
  ctx.save(); ctx.translate(proj.x, proj.y); ctx.rotate(localTime*8);
  ctx.fillStyle='#cc5500'; ctx.beginPath(); ctx.ellipse(0,0,12,14,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#ee8833'; ctx.beginPath(); ctx.ellipse(0,-4,8,8,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#222'; ctx.beginPath(); ctx.arc(-3,-5,1.5,0,Math.PI*2); ctx.arc(3,-5,1.5,0,Math.PI*2); ctx.fill();
  ctx.globalAlpha=0.3; ctx.fillStyle='#ff8833'; ctx.beginPath(); ctx.arc(0,0,16,0,Math.PI*2); ctx.fill();
  ctx.restore();
}

// =====================================================
//  DRAWING — PARTICLES & TEXT
// =====================================================
function drawParticles() {
  for (let p of particles) {
    ctx.save(); ctx.globalAlpha=p.life; ctx.translate(p.x,p.y); ctx.rotate(p.rot);
    if (p.type==='star') { ctx.fillStyle=p.color; drawStar(0,0,5,p.size,p.size/2); }
    else { ctx.fillStyle=p.color; ctx.beginPath(); ctx.arc(0,0,p.size,0,Math.PI*2); ctx.fill(); }
    ctx.restore();
  }
}

function drawStar(cx,cy,spikes,outerR,innerR) {
  let rot=Math.PI/2*3, step=Math.PI/spikes;
  ctx.beginPath(); ctx.moveTo(cx,cy-outerR);
  for (let i=0;i<spikes;i++) {
    ctx.lineTo(cx+Math.cos(rot)*outerR,cy+Math.sin(rot)*outerR); rot+=step;
    ctx.lineTo(cx+Math.cos(rot)*innerR,cy+Math.sin(rot)*innerR); rot+=step;
  }
  ctx.closePath(); ctx.fill();
}

function drawFloatingTexts() {
  for (let ft of floatingTexts) {
    ctx.save(); ctx.globalAlpha=ft.life;
    ctx.font=`bold ${ft.size}px 'Bungee',cursive`; ctx.textAlign='center';
    ctx.strokeStyle='rgba(0,0,0,0.5)'; ctx.lineWidth=3; ctx.strokeText(ft.text,ft.x,ft.y);
    ctx.fillStyle=ft.color; ctx.fillText(ft.text,ft.x,ft.y);
    ctx.restore();
  }
}

// =====================================================
//  HUD
// =====================================================
function drawHUD(state) {
  let me = state.players[myPlayerId];

  let pArr = Object.values(state.players).sort((a,b) => b.kills-a.kills);
  let py = 16;
  ctx.textAlign='right'; ctx.font="bold 13px 'Nunito',sans-serif";
  for (let p of pArr) {
    let tc = p.team===1?'PUN':'LUL';
    let text = `[${tc}] ${p.name}: ${p.hp}HP | ${p.kills} kills`;
    ctx.strokeStyle='rgba(0,0,0,0.5)'; ctx.lineWidth=3; ctx.strokeText(text, W-20, py+12);
    ctx.fillStyle = p.alive ? p.color : 'rgba(255,255,255,0.3)';
    ctx.fillText(text, W-20, py+12);
    if (me && p.id===myPlayerId) { ctx.fillStyle='rgba(255,204,68,0.3)'; ctx.fillRect(W-250,py,238,18); }
    py += 20;
  }

  let t1Alive = pArr.filter(p=>p.alive&&p.team===1).length;
  let t2Alive = pArr.filter(p=>p.alive&&p.team===2).length;
  let rs = state.roundScores || {1:0, 2:0};
  ctx.textAlign='center'; ctx.font="bold 16px 'Bungee',cursive";
  ctx.strokeStyle='rgba(0,0,0,0.5)'; ctx.lineWidth=3;
  let at = `Punch: ${t1Alive} [${rs[1]}]  |  [${rs[2]}] Lulu: ${t2Alive}`;
  ctx.strokeText(at, W/2, 28); ctx.fillStyle='#ffcc44'; ctx.fillText(at, W/2, 28);

  // Mode + Round label
  ctx.font="bold 12px 'Nunito',sans-serif"; ctx.fillStyle='#aaa';
  let roundLabel = `${state.mode} | R${state.currentRound||1}/5 | ${state.lobbyName||''}`;
  if (state.entryFee > 0) roundLabel += ` | Pool: ${state.prizePool} SOL`;
  ctx.fillText(roundLabel, W/2, 48);

  // Spectator banner
  if (isSpectating) {
    ctx.textAlign='center'; ctx.font="bold 20px 'Bungee',cursive";
    ctx.strokeStyle='rgba(0,0,0,0.7)'; ctx.lineWidth=4;
    ctx.strokeText('SPECTATING', W/2, H-30); ctx.fillStyle='#f5c842'; ctx.fillText('SPECTATING', W/2, H-30);
    ctx.font="13px 'Nunito',sans-serif"; ctx.fillStyle='#aaa'; ctx.fillText('Press ESC to leave', W/2, H-10);
  }
  // Dead player watching teammates (2v2, 3v3)
  else if (me && !me.alive) {
    ctx.textAlign='center'; ctx.font="bold 28px 'Bungee',cursive";
    ctx.strokeStyle='rgba(0,0,0,0.7)'; ctx.lineWidth=4;
    ctx.strokeText('YOU DIED', W/2, H/2); ctx.fillStyle='#ff4444'; ctx.fillText('YOU DIED', W/2, H/2);
    ctx.font="16px 'Nunito',sans-serif"; ctx.fillStyle='#aaa'; ctx.fillText('Watching your team...', W/2, H/2+30);
  }
}

// =====================================================
//  MAIN RENDER
// =====================================================
function render() {
  ctx.save();
  if (shakeTimer > 0) ctx.translate((Math.random()-0.5)*shakeIntensity, (Math.random()-0.5)*shakeIntensity);
  drawBackground();

  let shouldRender = serverState && (serverState.gameState === 'playing' || (isSpectating && serverState.gameState === 'playing'));
  if (shouldRender) {
    if (serverState.projectiles) for (let proj of serverState.projectiles) drawProjectile(proj);
    let pArr = Object.values(serverState.players).sort((a,b) => a.y-b.y);
    for (let p of pArr) drawPlayer(p, p.id===myPlayerId);

    if (!isSpectating) {
      let me = serverState.players[myPlayerId];
      if (me && me.punching && me.alive) {
        ctx.save(); ctx.translate(me.x, me.y);
        ctx.globalAlpha=0.15; ctx.fillStyle = me.usingSuperPunch ? '#ff4400' : '#ffaa00';
        let range = me.usingSuperPunch ? 120 : 80;
        ctx.beginPath(); ctx.moveTo(0,0); ctx.arc(0,0,range,me.aimAngle-0.35,me.aimAngle+0.35); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }

    drawParticles();
    drawFloatingTexts();
    drawHUD(serverState);
  }
  ctx.restore();
}

// =====================================================
//  UPDATE & GAME LOOP
// =====================================================
function update(dt) {
  localTime += dt;
  if (shakeTimer > 0) shakeTimer -= dt;
  for (let p of particles) { p.x+=p.vx; p.y+=p.vy; p.vy+=0.1; p.life-=p.decay; p.rot+=p.rotSpeed; p.size*=0.99; }
  particles = particles.filter(p => p.life > 0);
  for (let ft of floatingTexts) { ft.y+=ft.vy; ft.life-=ft.decay; }
  floatingTexts = floatingTexts.filter(ft => ft.life > 0);
  sendAim();
}

let lastTime = 0;
function gameLoop(timestamp) {
  let dt = Math.min((timestamp - lastTime) / 1000, 0.05);
  lastTime = timestamp;
  update(dt);
  render();
  requestAnimationFrame(gameLoop);
}

// =====================================================
//  INIT
// =====================================================
if (tryAutoLogin()) {
  showScreen('menu');
} else {
  showScreen('auth');
}
connect();
requestAnimationFrame(gameLoop);
