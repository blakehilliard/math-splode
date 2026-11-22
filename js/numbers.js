// Number words: parsing recognizer text into numbers, and the recognizer's grammar.

export const WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
export const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

export function numberToWords(n) {
  const ones = Object.keys(WORDS), tens = Object.keys(TENS);
  if (n < 20) return ones[n];
  if (n === 100) return 'one hundred';
  const t = tens[Math.floor(n / 10) - 2], u = n % 10;
  return u ? `${t} ${ones[u]}` : t;
}

// Returns every number found in a transcript, e.g. "seven two" -> [7, 2], "twenty one" -> [21].
export function parseNumbers(transcript) {
  const found = new Set();
  const tokens = transcript.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  let total = null;
  const flush = () => { if (total !== null) found.add(total); total = null; };
  for (const w of tokens) {
    if (w in TENS) { flush(); total = TENS[w]; }
    else if (w in WORDS) {
      if (total !== null && total % 10 === 0 && total >= 20 && WORDS[w] < 10) total += WORDS[w];
      else { flush(); total = WORDS[w]; }
    }
    else if (w === 'hundred') { total = (total ?? 1) * 100; }
    else flush();
  }
  flush();
  return [...found];
}

// Each number 0–100 is its own whole phrase, so the recognizer weighs "seventy" as one unit
// against "seven". [unk] catches anything that isn't a number.
export const GRAMMAR = JSON.stringify([
  ...Array.from({ length: 101 }, (_, n) => numberToWords(n)),
  'a hundred', // 10 × 10
  '[unk]',
]);
