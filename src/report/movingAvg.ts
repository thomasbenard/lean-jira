// pourquoi : dupliqué depuis le bloc <script> embarqué — les fonctions JS du template
// ne peuvent pas être importées directement par Vitest ; cette version TypeScript
// reste la seule surface testable unitairement.
export function computeMovingAvg(values: number[], windowSize = 4): (number | null)[] {
  return values.map((_, i) => {
    if (i < windowSize - 1) {return null;}
    const slice = values.slice(i - windowSize + 1, i + 1);
    return Math.round((slice.reduce((a, b) => a + b, 0) / windowSize) * 100) / 100;
  });
}
