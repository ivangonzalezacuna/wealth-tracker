const EN_LOCALE = 'en-GB';

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatEnglishMonth(month: string): string {
  if (!month) return '-';
  const [year, mm] = month.split('-');
  const monthIdx = Number(mm) - 1;
  if (!year || monthIdx < 0 || monthIdx > 11) return month || '-';
  return `${MONTHS_EN[monthIdx]} ${year}`;
}

export function formatEnglishDay(day: string): string {
  if (!day) return '-';
  const date = new Date(`${day}T12:00:00`);
  if (isNaN(date.getTime())) return day;
  return new Intl.DateTimeFormat(EN_LOCALE, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatEnglishDate(
  value: Date,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' },
): string {
  if (isNaN(value.getTime())) return '';
  return new Intl.DateTimeFormat(EN_LOCALE, options).format(value);
}

export function formatEnglishDateTime(value: Date): string {
  if (isNaN(value.getTime())) return '';
  return new Intl.DateTimeFormat(EN_LOCALE, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
}
