// Text-to-speech (built-in speechSynthesis) and offline speech recognition (Vosk, in-page).
/* global Vosk */
import { GRAMMAR, parseNumbers } from './numbers.js';

const MODEL_URL = new URL('../models/vosk-model-small-en-us-0.15.tar.gz', import.meta.url).href;

// A wrong-looking answer is only judged after this much quiet, in case the kid is still talking.
const SETTLE_MS = 1000;
const VOICE_PEAK = 0.05; // mic level that counts as "still talking"

// Debug: add ?nomic to the URL to play without a microphone. Answers can then be "heard" from
// the browser console with mathsplodeDebug.hear('twelve').
const NO_MIC = new URLSearchParams(location.search).has('nomic');

// ---------- Model loading (starts as soon as the page opens) ----------
let model = null;
export const modelReady = (typeof Vosk === 'undefined')
  ? Promise.reject(new Error('vosk.js failed to load'))
  : Vosk.createModel(MODEL_URL).then(m => { model = m; return m; });
modelReady.catch(() => {}); // callers handle the error; avoid an unhandled-rejection warning

// The model is cached in IndexedDB after the first (slow) download; ask the browser to keep it.
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

// ---------- Text-to-speech ----------
const hasTTS = 'speechSynthesis' in window;
let voice = null;
function pickVoice() {
  const vs = speechSynthesis.getVoices().filter(v => v.lang.toLowerCase().startsWith('en'));
  voice = vs.find(v => v.default) || vs.find(v => v.lang === 'en-US' && v.localService) || vs[0] || null;
}
if (hasTTS) {
  pickVoice();
  speechSynthesis.addEventListener('voiceschanged', pickVoice);
}

export function speak(text) {
  return new Promise(resolve => {
    if (!hasTTS) return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (voice) { u.voice = voice; u.lang = voice.lang; } else { u.lang = 'en-US'; }
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    u.onend = finish;
    u.onerror = finish;
    // Some Android voices never fire onend; give up waiting after a length-based guess.
    setTimeout(finish, 2500 + text.length * 120);
    speechSynthesis.speak(u);
  });
}

export function stopSpeaking() {
  if (hasTTS) speechSynthesis.cancel();
}

// ---------- Microphone + recognizer ----------
let audioCtx = null, recognizer = null, procNode = null, micReady = null;
let listener = null; // the active listenForAnswer() call, if any

// Call from a click handler: browsers only allow audio/mic to start after a user tap.
export function initMic() {
  if (micReady) { audioCtx?.resume(); return micReady; }
  if (NO_MIC) return (micReady = modelReady.then(() => {}));
  // Create the AudioContext synchronously, while we still have the tap's permission.
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  micReady = (async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: false,
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
    await modelReady;
    recognizer = new model.KaldiRecognizer(audioCtx.sampleRate, GRAMMAR);
    recognizer.on('partialresult', m => listener?.partial(m.result.partial || ''));
    recognizer.on('result', m => listener?.result(m.result.text || ''));

    // ScriptProcessor is deprecated but supported everywhere, including older tablets.
    procNode = audioCtx.createScriptProcessor(4096, 1, 1);
    procNode.onaudioprocess = e => {
      if (!listener) return; // only feed audio while listening, so it never hears our own voice
      const data = e.inputBuffer.getChannelData(0);
      let peak = 0;
      for (let i = 0; i < data.length; i += 16) peak = Math.max(peak, Math.abs(data[i]));
      listener.level(peak);
      try { recognizer.acceptWaveform(e.inputBuffer); } catch { /* skip a bad chunk */ }
    };
    audioCtx.createMediaStreamSource(stream).connect(procNode);
    procNode.connect(audioCtx.destination); // some browsers only run the node when connected
    await audioCtx.resume();
  })();
  micReady.catch(() => { micReady = null; }); // allow a retry after a failure
  return micReady;
}

/**
 * Listen for one answer. Resolves with { outcome, numbers, heard } where outcome is
 * 'correct' (heard the answer), 'wrong' (heard other numbers, then the kid went quiet),
 * 'timeout' (nothing usable before timeoutMs) or 'cancelled'.
 */
export function listenForAnswer(answer, { timeoutMs = 10000, onHearing, onLevel } = {}) {
  cancelListening();
  return new Promise(resolve => {
    const startedAt = performance.now();
    const heard = [];
    let lastVoiceAt = 0, lastPartialAt = 0, settleTimer = null;
    const numbers = () => [...new Set(heard.flatMap(parseNumbers))];

    const finish = outcome => {
      if (listener !== l) return;
      listener = null;
      clearTimeout(deadline);
      clearTimeout(settleTimer);
      // Flush buffered audio so leftovers don't leak into the next question.
      recognizer?.retrieveFinalResult();
      resolve({ outcome, numbers: numbers(), heard });
    };
    const scheduleSettle = () => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        const quietFor = performance.now() - Math.max(lastVoiceAt, lastPartialAt);
        if (quietFor < SETTLE_MS) scheduleSettle(); // still talking, keep waiting
        else finish('wrong');
      }, SETTLE_MS);
    };

    const l = {
      level(peak) {
        if (peak > VOICE_PEAK) lastVoiceAt = performance.now();
        onLevel?.(peak);
      },
      partial(text) {
        if (!text) return;
        lastPartialAt = performance.now();
        onHearing?.(text);
      },
      result(text) {
        text = text.trim();
        // Results right after listening starts are leftovers flushed from the previous question.
        if (!text || performance.now() - startedAt < 400) return;
        heard.push(text);
        if (parseNumbers(text).includes(answer)) return finish('correct');
        // [unk] means part of it didn't sound like a number (e.g. a mumbled "seventy").
        // Don't call that wrong; keep listening so they can say it again.
        if (text.includes('[unk]')) return;
        scheduleSettle();
      },
      cancel() { finish('cancelled'); },
    };
    listener = l;
    const deadline = setTimeout(() => finish(numbers().length ? 'wrong' : 'timeout'), timeoutMs);
  });
}

export function cancelListening() {
  listener?.cancel();
}

if (NO_MIC) {
  window.mathsplodeDebug = { hear: text => listener?.result(text) };
}
