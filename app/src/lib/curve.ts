export function tokenCost(
  base: bigint,
  slope: bigint,
  supply: bigint,
  amount: bigint,
  decimals: number
): bigint {
  if (amount === 0n) return 0n;
  const scale = 10n ** BigInt(decimals);
  const term1 = (amount * base) / scale;
  const span = supply * 2n + amount - 1n;
  const term2 = (slope * amount * span) / (2n * scale * scale);
  return term1 + term2;
}

export function tokensOutForSol(
  base: bigint,
  slope: bigint,
  supply: bigint,
  solIn: bigint,
  decimals: number
): bigint {
  if (solIn === 0n) return 0n;
  const scale = 10n ** BigInt(decimals);
  let hi = solIn * scale;
  if (hi === 0n) hi = solIn;
  const oneCost = tokenCost(base, slope, supply, 1n, decimals);
  if (oneCost > solIn) return 0n;
  let lo = 0n;
  while (lo < hi) {
    const mid = lo + (hi - lo + 1n) / 2n;
    const cost = tokenCost(base, slope, supply, mid, decimals);
    if (cost <= solIn) lo = mid;
    else hi = mid - 1n;
  }
  return lo;
}

export function formatLamports(lamports: bigint | number): string {
  const n = typeof lamports === "number" ? lamports : Number(lamports);
  return (n / 1_000_000_000).toFixed(4);
}

export function formatStock(amount: bigint | number, decimals = 6): string {
  const n = typeof amount === "number" ? amount : Number(amount);
  return (n / 10 ** decimals).toLocaleString(undefined, {
    maximumFractionDigits: 4,
  });
}
