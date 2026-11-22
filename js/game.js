// Screens and round logic: menu -> round of 20 questions -> victory.
import { OPERATIONS, getLevel, setLevel } from './storage.js';
import { maxNumber, maxLevel } from './levels.js';
import { modelReady, initMic, speak, stopSpeaking, listenForAnswer, cancelListening } from './speech.js';

const QUESTIONS_PER_ROUND = 20;
const ANSWER_TIME_MS = 10000;

const OPS = {
  addition:       { label: 'Addition',       symbol: '+', word: 'plus',  calc: (a, b) => a + b },
  subtraction:    { label: 'Subtraction',    symbol: '−', word: 'minus', calc: (a, b) => a - b },
  multiplication: { label: 'Multiplication', symbol: '×', word: 'times', calc: (a, b) => a * b },
};

const $ = sel => document.querySelector(sel);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- Questions ----------
// Every problem whose numbers are all between 0 and max.
function allQuestions(op, max) {
  const qs = [];
  for (let a = 0; a <= max; a++) {
    // Subtraction: b <= a, so the answer is never negative.
    for (let b = 0; b <= (op === 'subtraction' ? a : max); b++) qs.push({ a, b });
  }
  return qs.map(q => ({ ...q, answer: OPS[op].calc(q.a, q.b) }));
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Up to 20 different questions. Low levels have fewer possible problems (e.g. 4 at addition
// level 1: 0+0, 0+1, 1+0, 1+1), so those rounds are shorter instead of repeating questions.
const pickRound = (op, level) =>
  shuffle(allQuestions(op, maxNumber(op, level))).slice(0, QUESTIONS_PER_ROUND);

const levelText = (op, level) => `Level ${level} / ${maxLevel(op)}`;
const questionText = (op, q) => `${q.a} ${OPS[op].symbol} ${q.b}`;
const questionSpoken = (op, q) => `${q.a} ${OPS[op].word} ${q.b}`;

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---------- Screens ----------
function show(id) {
  document.querySelectorAll('.screen').forEach(el => { el.hidden = el.id !== id; });
}

function renderMenu() {
  const box = $('#opButtons');
  box.innerHTML = '';
  for (const op of OPERATIONS) {
    const btn = document.createElement('button');
    btn.className = `op-btn op-${op}`;
    btn.innerHTML = `<span class="op-symbol">${OPS[op].symbol}</span>` +
      `<span class="op-name">${OPS[op].label}</span>` +
      `<span class="op-level">${levelText(op, getLevel(op))}</span>`;
    btn.addEventListener('click', () => startRound(op));
    box.appendChild(btn);
  }
  show('menu');
}

// Voice status on the menu, since the first model download can take about a minute on a tablet.
$('#voiceStatus').textContent = '🎤 Getting the voice ready… (the first time can take a minute)';
modelReady
  .then(() => { $('#voiceStatus').textContent = '🎤 Voice ready'; })
  .catch(() => { $('#voiceStatus').textContent = '⚠️ Voice recognition failed to load. Try reloading the page.'; });

// ---------- Round ----------
let round = null;

function setFeedback(html, cls = '') {
  const el = $('#feedback');
  el.className = cls;
  el.innerHTML = html;
}

function updateRemaining() {
  $('#remaining').textContent = `${round.queue.length} left`;
}

function startCountdown(ms) {
  const bar = $('#countdownFill');
  const start = performance.now();
  const tick = () => {
    if (!round || round.countdownStart !== start) return;
    const left = Math.max(0, 1 - (performance.now() - start) / ms);
    bar.style.width = `${left * 100}%`;
    bar.classList.toggle('low', left < 0.3);
    if (left > 0) requestAnimationFrame(tick);
  };
  round.countdownStart = start;
  requestAnimationFrame(tick);
}
function stopCountdown() {
  if (round) round.countdownStart = null;
}

async function startRound(op) {
  stopRound();
  const level = getLevel(op);
  const r = round = { op, level, queue: pickRound(op, level), misses: 0, startedAt: 0, clock: null, countdownStart: null, over: false };
  $('#playTitle').textContent = `${OPS[op].label} · ${levelText(op, level)}`;
  $('#question').textContent = '';
  $('#clock').textContent = '0:00';
  $('#countdownFill').style.width = '100%';
  updateRemaining();
  setFeedback('Getting ready…');
  show('play');

  try {
    await initMic();
  } catch (err) {
    if (round !== r) return;
    setFeedback(`Couldn't turn on the microphone (${err && err.message || err}). Check the mic permission and try again.`, 'bad');
    return;
  }
  if (round !== r) return;

  r.startedAt = performance.now();
  r.clock = setInterval(() => { $('#clock').textContent = formatTime(performance.now() - r.startedAt); }, 250);

  while (r.queue.length) {
    const q = r.queue[0];
    $('#question').textContent = `${questionText(op, q)} = ?`;
    setFeedback('');
    $('#countdownFill').style.width = '100%';
    await speak(questionSpoken(op, q));
    if (round !== r) return;

    setFeedback('🎤 Say the answer!', 'listening');
    startCountdown(ANSWER_TIME_MS);
    const res = await listenForAnswer(q.answer, {
      timeoutMs: ANSWER_TIME_MS,
      onHearing: text => { if (round === r && !text.includes('[unk]')) setFeedback(`🎤 “${text}”`, 'listening'); },
      onLevel: peak => { $('#mic').style.transform = `scale(${1 + Math.min(0.6, peak * 3)})`; },
    });
    stopCountdown();
    $('#mic').style.transform = '';
    if (round !== r) return;

    if (res.outcome === 'correct') {
      r.queue.shift();
      updateRemaining();
      $('#question').textContent = `${questionText(op, q)} = ${q.answer}`;
      setFeedback('✅ Correct!', 'ok');
      await sleep(700);
    } else {
      r.misses++;
      const said = res.numbers.length ? `You said ${res.numbers.join(' or ')}. ` : (res.outcome === 'timeout' ? 'Out of time! ' : '');
      $('#question').textContent = `${questionText(op, q)} = ${q.answer}`;
      setFeedback(`${said}The answer is <b>${q.answer}</b>.`, 'bad');
      await speak(`The answer is ${q.answer}`);
      if (round !== r) return;
      await sleep(900);
      r.queue.push(r.queue.shift()); // try it again later in the round
    }
    if (round !== r) return;
  }

  const elapsed = performance.now() - r.startedAt;
  clearInterval(r.clock);
  r.over = true;
  showVictory(r, elapsed);
}

function stopRound() {
  if (!round) return;
  clearInterval(round.clock);
  round = null;
  cancelListening();
  stopSpeaking();
}

function showVictory(r, elapsed) {
  $('#victoryTime').textContent = formatTime(elapsed);
  $('#victoryMisses').textContent = r.misses === 0 ? 'No mistakes!' : `${r.misses} mistake${r.misses === 1 ? '' : 's'}`;

  // A perfect round levels you up, until the top level.
  const top = maxLevel(r.op);
  let levelMsg, spoken = 'Victory!';
  if (r.misses > 0) {
    levelMsg = `Still ${levelText(r.op, r.level)}. Get every question right to level up!`;
  } else if (r.level < top) {
    const next = r.level + 1;
    setLevel(r.op, next);
    levelMsg = `⭐ LEVEL UP! You're now ${levelText(r.op, next)} ⭐`;
    spoken = `Victory! Level up! You're now level ${next}.`;
  } else {
    levelMsg = `🏆 You're at the top level: ${levelText(r.op, r.level)}!`;
  }
  $('#victoryLevel').textContent = levelMsg;
  $('#victoryLevel').classList.toggle('levelup', r.misses === 0 && r.level < top);

  $('#againBtn').onclick = () => startRound(r.op);
  show('victory');
  speak(spoken);
}

$('#quitBtn').addEventListener('click', () => { stopRound(); renderMenu(); });
$('#menuBtn').addEventListener('click', () => { stopRound(); renderMenu(); });

renderMenu();
