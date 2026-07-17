/**
 * Format manual datetime for the device time API.
 * Uses wall-clock components from the picker (local Date getters) and the
 * selected IANA timezone offset — not UTC (toISOString).
 */
export function formatManualDateTimeRFC3339(
  date: Date,
  timeZone: string
): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const wall = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  const offset = getTimezoneOffsetString(timeZone, date);
  return `${wall}${offset}`;
}

function getTimezoneOffsetString(timeZone: string, date: Date): string {
  try {
    const token = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
    })
      .formatToParts(date)
      .find(part => part.type === 'timeZoneName')?.value;

    if (!token) return '+00:00';

    const match = token.match(/(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?/i);
    if (!match) return '+00:00';

    const sign = match[1];
    const hours = match[2].padStart(2, '0');
    const minutes = (match[3] ?? '00').padStart(2, '0');
    return `${sign}${hours}:${minutes}`;
  } catch {
    return '+00:00';
  }
}
