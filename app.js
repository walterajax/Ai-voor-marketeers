// ==========================================
//  STATE
// ==========================================
let role = null;
let playerName = null;
let serverTimeOffset = 0;
let timerInterval = null;
let myAnswers = {};
let players = {};
let currentQIndex = 0;
let answersListenerRef = null;

const ANSWER_COLORS = ['a', 'b', 'c', 'd'];
const ANSWER_LABELS = ['A', 'B', 'C', 'D'];
const TIMER_DURATION = 20000;
const CIRCUMFERENCE = 283;

// ==========================================
//  UTILITIES
// ==========================================
function serverNow() {
  return Date.now() + serverTimeOffset;
}

const HOST_QR_SCREENS = new Set([
  'screen-host-question',
  'screen-host-reveal',
  'screen-host-end'
]);

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
  const watermark = document.getElementById('host-qr-watermark');
  if (watermark) watermark.style.display = HOST_QR_SCREENS.has(id) ? 'flex' : 'none';
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// ==========================================
//  INITIALIZATION
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
  if (!initFirebase()) {
    document.getElementById('firebase-overlay').style.display = 'flex';
    return;
  }

  db.ref('.info/serverTimeOffset').on('value', snap => {
    serverTimeOffset = snap.val() || 0;
  });

  showScreen('screen-role');
});

function selectRole(selectedRole) {
  role = selectedRole;
  if (role === 'host') {
    initHost();
  } else {
    showScreen('screen-player-join');
    setTimeout(() => document.getElementById('player-name-input').focus(), 100);
  }
}

// ==========================================
//  HOST — LOBBY
// ==========================================
async function initHost() {
  try {
    const stateSnap = await db.ref('quiz/state').once('value');
    const existingState = stateSnap.val();
    if (existingState && existingState.phase !== 'lobby') {
      if (!confirm('Er is al een quiz bezig. Wil je opnieuw beginnen? Alle data wordt gewist.')) {
        showScreen('screen-role');
        return;
      }
    }
  } catch (e) {
    alert('Firebase fout: ' + e.message + '\n\nControleer:\n1. Database staat in testmodus\n2. De databaseURL in firebase.js klopt');
    showScreen('screen-role');
    return;
  }

  try {
    await db.ref('quiz').set({
      state: { phase: 'lobby', qIndex: 0, startTime: 0 },
      players: {},
      answers: {}
    });
  } catch (e) {
    alert('Kan niet schrijven naar Firebase: ' + e.message);
    showScreen('screen-role');
    return;
  }

  myAnswers = {};
  players = {};
  currentQIndex = 0;

  showScreen('screen-host-lobby');
  setupLobbyUrl();
  generateQR();
  showQuestionPreview();
  listenToPlayers();
}

function setupLobbyUrl() {
  const url = window.location.origin + window.location.pathname;
  document.getElementById('lobby-url-text').textContent = url;
}

function generateQR() {
  const url = window.location.origin + window.location.pathname;
  const encoded = encodeURIComponent(url);
  const base = 'https://api.qrserver.com/v1/create-qr-code/?color=000000&bgcolor=FFFFFF&margin=1';

  document.getElementById('qr-code').innerHTML =
    `<img src="${base}&size=180x180&data=${encoded}" width="180" height="180" alt="QR Code">`;

  document.getElementById('host-qr-mini').innerHTML =
    `<img src="${base}&size=90x90&data=${encoded}" width="90" height="90" alt="QR Code">`;

  document.getElementById('host-qr-label').textContent = 'Doe mee →';
}

function copyUrl() {
  const url = window.location.origin + window.location.pathname;
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.getElementById('btn-copy');
    btn.textContent = '✅ Gekopieerd!';
    setTimeout(() => { btn.textContent = '📋 Kopieer'; }, 2000);
  }).catch(() => {
    prompt('Kopieer deze link:', url);
  });
}

function listenToPlayers() {
  db.ref('quiz/players').on('value', snap => {
    players = snap.val() || {};
    const names = Object.keys(players);

    document.getElementById('player-count').textContent = names.length;
    document.getElementById('player-list').innerHTML =
      names.map(n => `<div class="player-chip">${escapeHtml(n)}</div>`).join('');

    document.getElementById('btn-start').disabled = names.length === 0;
  });
}

function showQuestionPreview() {
  const q = QUESTIONS[0];
  document.getElementById('question-preview').innerHTML = `
    <div class="preview-question">${escapeHtml(q.q)}</div>
    <div class="preview-options">
      ${q.options.map((opt, i) => `
        <div class="preview-option answer-${ANSWER_COLORS[i]}">
          <strong>${ANSWER_LABELS[i]}.</strong> ${escapeHtml(opt)}
        </div>`).join('')}
    </div>`;
}

// ==========================================
//  HOST — QUESTION
// ==========================================
async function startQuiz() {
  const names = Object.keys(players);
  if (names.length === 0) return;

  // Reset all scores to 0
  const resets = {};
  names.forEach(n => { resets[`quiz/players/${n}`] = 0; });
  await db.ref().update(resets);

  loadQuestion(0);
}

async function loadQuestion(qIndex) {
  const startTime = serverNow();
  currentQIndex = qIndex;
  myAnswers = {};

  await db.ref('quiz/state').set({
    phase: 'question',
    qIndex,
    startTime
  });

  showHostQuestion(qIndex, startTime);
}

function showHostQuestion(qIndex, startTime) {
  stopTimer();
  showScreen('screen-host-question');

  const q = QUESTIONS[qIndex];
  document.getElementById('host-q-number').textContent =
    `Vraag ${qIndex + 1} / ${QUESTIONS.length}`;
  document.getElementById('host-q-text').textContent = q.q;

  document.getElementById('host-answer-grid').innerHTML =
    q.options.map((opt, i) => `
      <div class="answer-option answer-${ANSWER_COLORS[i]}">
        <span class="answer-label">${ANSWER_LABELS[i]}</span>
        <span class="answer-text">${escapeHtml(opt)}</span>
      </div>`).join('');

  // Reset timer ring
  const circle = document.getElementById('timer-circle');
  if (circle) {
    circle.style.stroke = '#5CBB6E';
    circle.style.strokeDashoffset = '0';
  }

  listenAnswerCount(qIndex);
  startHostTimer(startTime, qIndex);
}

function listenAnswerCount(qIndex) {
  if (answersListenerRef) {
    answersListenerRef.off();
  }
  answersListenerRef = db.ref(`quiz/answers/q${qIndex}`);
  answersListenerRef.on('value', snap => {
    const answered = Object.keys(snap.val() || {}).length;
    const total = Object.keys(players).length;
    document.getElementById('answer-counter').textContent =
      `${answered} van ${total} ${total === 1 ? 'heeft' : 'hebben'} geantwoord`;
  });
}

function startHostTimer(startTime, qIndex) {
  timerInterval = setInterval(() => {
    const elapsed = serverNow() - startTime;
    const remaining = Math.max(0, Math.ceil((TIMER_DURATION - elapsed) / 1000));
    const progress = Math.min(1, elapsed / TIMER_DURATION);

    document.getElementById('host-timer').textContent = remaining;

    const circle = document.getElementById('timer-circle');
    if (circle) {
      circle.style.strokeDashoffset = CIRCUMFERENCE * progress;
      if (remaining <= 5) circle.style.stroke = '#E8614A';
      else if (remaining <= 10) circle.style.stroke = '#F0A034';
    }

    if (elapsed >= TIMER_DURATION) {
      stopTimer();
      revealAnswer(qIndex);
    }
  }, 100);
}

// ==========================================
//  HOST — REVEAL
// ==========================================
async function revealAnswer(qIndex) {
  if (answersListenerRef) {
    answersListenerRef.off();
    answersListenerRef = null;
  }

  const snap = await db.ref(`quiz/answers/q${qIndex}`).once('value');
  const answers = snap.val() || {};
  const correct = QUESTIONS[qIndex].correct;

  // Refresh local players scores from Firebase
  const playersSnap = await db.ref('quiz/players').once('value');
  players = playersSnap.val() || {};

  // Award points
  const updates = {};
  Object.entries(answers).forEach(([name, ansIdx]) => {
    if (ansIdx === correct && players[name] !== undefined) {
      updates[`quiz/players/${name}`] = (players[name] || 0) + 100;
    }
  });
  if (Object.keys(updates).length > 0) {
    await db.ref().update(updates);
    Object.entries(updates).forEach(([path, val]) => {
      const n = path.split('/')[2];
      players[n] = val;
    });
  }

  await db.ref('quiz/state').update({ phase: 'reveal' });

  showHostReveal(qIndex, answers);
}

function showHostReveal(qIndex, answers) {
  showScreen('screen-host-reveal');

  const q = QUESTIONS[qIndex];
  const correct = q.correct;
  const counts = [0, 0, 0, 0];
  Object.values(answers).forEach(a => { if (a >= 0 && a <= 3) counts[a]++; });

  document.getElementById('reveal-q-number').textContent =
    `Vraag ${qIndex + 1} / ${QUESTIONS.length}`;
  document.getElementById('reveal-q-text').textContent = q.q;

  document.getElementById('reveal-answer-grid').innerHTML =
    q.options.map((opt, i) => `
      <div class="answer-option answer-${ANSWER_COLORS[i]} ${i === correct ? 'is-correct' : 'is-incorrect'}">
        <span class="answer-label">${i === correct ? '✓' : ANSWER_LABELS[i]}</span>
        <span class="answer-text">${escapeHtml(opt)}</span>
      </div>`).join('');

  const maxCount = Math.max(...counts, 1);
  document.getElementById('answer-bars').innerHTML =
    counts.map((count, i) => `
      <div class="answer-bar-wrap">
        <div class="answer-bar answer-bar-${ANSWER_COLORS[i]} ${i === correct ? 'bar-correct' : ''}"
             style="height:${Math.max(8, Math.round((count / maxCount) * 130))}px">
          <span class="bar-count">${count}</span>
        </div>
        <span class="bar-label">${ANSWER_LABELS[i]}</span>
      </div>`).join('');

  document.getElementById('next-btn-text').textContent =
    qIndex >= QUESTIONS.length - 1 ? '🏆 Bekijk eindstand' : 'Volgende vraag →';
}

async function nextQuestion() {
  const next = currentQIndex + 1;
  if (next >= QUESTIONS.length) {
    showFinalLeaderboard();
  } else {
    loadQuestion(next);
  }
}

async function showFinalLeaderboard() {
  const snap = await db.ref('quiz/players').once('value');
  players = snap.val() || {};
  await db.ref('quiz/state').update({ phase: 'end' });
  showScreen('screen-host-end');
  renderLeaderboard('host-leaderboard', players);
}

function renderLeaderboard(containerId, playersData) {
  const sorted = Object.entries(playersData).sort((a, b) => b[1] - a[1]);
  const medals = ['🥇', '🥈', '🥉'];
  document.getElementById(containerId).innerHTML = sorted.length === 0
    ? '<div class="lb-empty">Geen spelers</div>'
    : sorted.map(([name, score], i) => `
        <div class="lb-item rank-${Math.min(i + 1, 4)}">
          <span class="lb-rank">${medals[i] || (i + 1)}</span>
          <span class="lb-name">${escapeHtml(name)}</span>
          <span class="lb-score">${score} pts</span>
        </div>`).join('');
}

async function restartQuiz() {
  const snap = await db.ref('quiz/players').once('value');
  const existing = snap.val() || {};
  const resets = {};
  Object.keys(existing).forEach(n => { resets[n] = 0; });

  await db.ref('quiz').update({
    state: { phase: 'lobby', qIndex: 0, startTime: 0 },
    players: resets,
    answers: {}
  });

  players = resets;
  currentQIndex = 0;
  showScreen('screen-host-lobby');
  setupLobbyUrl();
  showQuestionPreview();
}

// ==========================================
//  PLAYER — JOIN
// ==========================================
async function joinQuiz() {
  const input = document.getElementById('player-name-input');
  const errorEl = document.getElementById('join-error');
  const name = input.value.trim();

  errorEl.textContent = '';

  if (!name || name.length < 2) {
    errorEl.textContent = 'Vul een naam in van minimaal 2 tekens.';
    return;
  }
  if (name.length > 20) {
    errorEl.textContent = 'Naam mag maximaal 20 tekens zijn.';
    return;
  }

  const stateSnap = await db.ref('quiz/state').once('value');
  const state = stateSnap.val();

  if (!state) {
    errorEl.textContent = 'Geen actieve quiz gevonden. Wacht op de host.';
    return;
  }

  if (state.phase !== 'lobby') {
    errorEl.textContent = 'De quiz is al gestart. Je kan niet meer meedoen.';
    return;
  }

  // Check duplicate — allow reconnect (same name, lobby phase = OK)
  const existingSnap = await db.ref(`quiz/players/${name}`).once('value');
  if (!existingSnap.exists()) {
    await db.ref(`quiz/players/${name}`).set(0);
  }

  playerName = name;
  showScreen('screen-player-waiting');
  document.getElementById('waiting-name').textContent = `Welkom, ${name}! 👋`;
  listenToGameState();
}

// ==========================================
//  PLAYER — GAME STATE LISTENER
// ==========================================
function listenToGameState() {
  db.ref('quiz/state').on('value', snap => {
    const state = snap.val();
    if (!state || role !== 'player') return;
    handlePlayerStateChange(state);
  });
}

function handlePlayerStateChange(state) {
  const { phase, qIndex, startTime } = state;

  if (phase === 'lobby') {
    showScreen('screen-player-waiting');
  } else if (phase === 'question') {
    if (myAnswers[qIndex] !== undefined) {
      showScreen('screen-player-answer-sent');
    } else {
      showPlayerQuestion(qIndex, startTime);
    }
  } else if (phase === 'reveal') {
    stopTimer();
    showPlayerReveal(qIndex);
  } else if (phase === 'end') {
    stopTimer();
    showPlayerEnd();
  }
}

// ==========================================
//  PLAYER — QUESTION
// ==========================================
function showPlayerQuestion(qIndex, startTime) {
  stopTimer();
  showScreen('screen-player-question');

  const q = QUESTIONS[qIndex];
  document.getElementById('player-q-number').textContent =
    `Vraag ${qIndex + 1} / ${QUESTIONS.length}`;
  document.getElementById('player-q-text').textContent = q.q;

  document.getElementById('player-answer-grid').innerHTML =
    q.options.map((opt, i) => `
      <button class="player-answer-btn answer-${ANSWER_COLORS[i]}"
              onclick="submitAnswer(${qIndex}, ${i})"
              id="player-btn-${i}">
        <span class="answer-label">${ANSWER_LABELS[i]}</span>
        <span class="answer-text">${escapeHtml(opt)}</span>
      </button>`).join('');

  startPlayerTimer(startTime, qIndex);
}

function startPlayerTimer(startTime, qIndex) {
  timerInterval = setInterval(() => {
    const elapsed = serverNow() - startTime;
    const remaining = Math.max(0, Math.ceil((TIMER_DURATION - elapsed) / 1000));
    const progress = Math.min(1, elapsed / TIMER_DURATION);

    const timerText = document.getElementById('player-timer-text');
    const fill = document.getElementById('player-timer-fill');
    if (timerText) timerText.textContent = remaining;
    if (fill) {
      fill.style.width = `${(1 - progress) * 100}%`;
      if (remaining <= 5) fill.style.background = '#E8614A';
      else if (remaining <= 10) fill.style.background = '#F0A034';
      else fill.style.background = '#5CBB6E';
    }

    if (elapsed >= TIMER_DURATION) {
      stopTimer();
      document.querySelectorAll('.player-answer-btn').forEach(btn => {
        btn.disabled = true;
        btn.style.opacity = '0.45';
      });
    }
  }, 100);
}

async function submitAnswer(qIndex, answerIdx) {
  if (myAnswers[qIndex] !== undefined) return;
  myAnswers[qIndex] = answerIdx;
  stopTimer();

  // Highlight selected button, dim others
  ANSWER_LABELS.forEach((_, i) => {
    const btn = document.getElementById(`player-btn-${i}`);
    if (!btn) return;
    btn.disabled = true;
    btn.style.opacity = i === answerIdx ? '1' : '0.35';
    if (i === answerIdx) btn.style.outline = '4px solid white';
  });

  await db.ref(`quiz/answers/q${qIndex}/${playerName}`).set(answerIdx);

  setTimeout(() => showScreen('screen-player-answer-sent'), 400);
}

// ==========================================
//  PLAYER — REVEAL & END
// ==========================================
async function showPlayerReveal(qIndex) {
  showScreen('screen-player-reveal');

  const q = QUESTIONS[qIndex];
  const correct = q.correct;
  const myAnswer = myAnswers[qIndex];
  const answered = myAnswer !== undefined;
  const isCorrect = answered && myAnswer === correct;

  document.getElementById('reveal-result-icon').textContent =
    !answered ? '⏱️' : isCorrect ? '✅' : '❌';

  const resultText = document.getElementById('reveal-result-text');
  resultText.textContent = !answered ? 'Te laat!' : isCorrect ? 'Correct!' : 'Helaas, fout!';
  resultText.className = `reveal-result-text ${isCorrect ? 'result-correct' : 'result-wrong'}`;

  document.getElementById('reveal-correct-answer').innerHTML =
    `Juist antwoord: <strong>${ANSWER_LABELS[correct]}. ${escapeHtml(q.options[correct])}</strong>`;

  const pointsEl = document.getElementById('reveal-points');
  pointsEl.textContent = isCorrect ? '+100 punten' : '+0 punten';
  pointsEl.className = `reveal-points ${isCorrect ? 'got-points' : 'no-points'}`;

  const scoreSnap = await db.ref(`quiz/players/${playerName}`).once('value');
  document.getElementById('player-total-score').textContent = scoreSnap.val() || 0;
}

async function showPlayerEnd() {
  showScreen('screen-player-end');

  const snap = await db.ref('quiz/players').once('value');
  const all = snap.val() || {};
  const sorted = Object.entries(all).sort((a, b) => b[1] - a[1]);
  const myRank = sorted.findIndex(([n]) => n === playerName) + 1;
  const myScore = all[playerName] || 0;
  const medals = ['🥇', '🥈', '🥉'];

  document.getElementById('player-end-icon').textContent = myRank === 1 ? '🏆' : myRank <= 3 ? medals[myRank - 1] : '🎉';
  document.getElementById('player-final-rank').innerHTML =
    `<span class="rank-badge">${medals[myRank - 1] || `#${myRank}`}</span> ${myRank}e plaats`;
  document.getElementById('player-final-score').textContent = `${myScore} punten`;

  if (sorted.length > 0 && sorted[0][0] !== playerName) {
    document.getElementById('player-winner-display').textContent =
      `🥇 Winnaar: ${sorted[0][0]} (${sorted[0][1]} punten)`;
  } else if (myRank === 1) {
    document.getElementById('player-winner-display').textContent = '🎊 Jij bent de winnaar!';
  }
}

// ==========================================
//  UTILITIES
// ==========================================
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
