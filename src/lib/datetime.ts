/**
 * Date/time formatting helpers. Timestamps are UTC; display uses the
 * configured reporting timezone (default Europe/Dublin).
 */
import { DEFAULT_TIMEZONE } from '../config';

export function formatDueDate(isoDate: string, timeZone: string = DEFAULT_TIMEZONE): string {
  if (!isoDate) return 'No date';
  const date = new Date(isoDate.length <= 10 ? `${isoDate}T00:00:00Z` : isoDate);
  if (Number.isNaN(date.getTime())) return isoDate;
  return new Intl.DateTimeFormat('en-IE', {
    day: '2-digit',
    month: 'short',
    timeZone,
  }).format(date);
}

export function formatTimestamp(iso: string, timeZone: string = DEFAULT_TIMEZONE): string {
  if (!iso) return 'No timestamp';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-IE', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(date);
}

export function relativeFromNow(iso: string | undefined, now: number = Date.now()): string {
  if (!iso) return 'no timestamp';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'no timestamp';
  const minutes = Math.floor(Math.max(0, now - then) / 60_000);
  if (minutes < 1) return 'updated just now';
  if (minutes < 60) return `updated ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `updated ${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `updated ${days} d ago`;
}
