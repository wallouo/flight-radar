export function gbpToMinorUnits(amount: number): number {
  return decimalToMinorUnits(amount);
}

export function decimalToMinorUnits(amount: number): number {
  return Math.round(amount * 100);
}

export function formatMinorUnits(amountMinor: number, currencyCode: string): string {
  return `${currencyCode} ${(amountMinor / 100).toFixed(2)}`;
}
