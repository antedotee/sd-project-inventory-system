import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });
const count = new Intl.NumberFormat();
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export const formatMoney = (cents: number) => money.format(cents / 100);
export const formatCount = (n: number) => count.format(n);
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));

export function formatDelta(n: number) {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${count.format(Math.abs(n))}`;
}

/** "12.50" -> 1250. Returns null for anything that is not a valid amount. */
export function parseMoneyToCents(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 100);
}
