// Level rules: each level raises the biggest number that can appear in a problem by 1.

const RULES = {
  addition:       { firstMax: 1, topMax: 20 },
  subtraction:    { firstMax: 1, topMax: 20 },
  multiplication: { firstMax: 1, topMax: 10 },
};

// Biggest number allowed in a problem at this level (operands; for subtraction also the answer).
export function maxNumber(op, level) {
  return RULES[op].firstMax + level - 1;
}

// Highest level: the one whose biggest number is topMax (addition 20, subtraction 20, multiplication 10).
export function maxLevel(op) {
  return RULES[op].topMax - RULES[op].firstMax + 1;
}
