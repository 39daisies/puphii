const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const longDateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const shortDateFormatter = new Intl.DateTimeFormat(undefined, { month: 'numeric', day: 'numeric' });
const weekdayFormatter = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const fullDayFormatter = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const monthDayFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const monthYearFormatter = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const monthShortFormatter = new Intl.DateTimeFormat(undefined, { month: 'short' });
const monthNarrowFormatter = new Intl.DateTimeFormat(undefined, { month: 'narrow' });
export const formatTime = (value: string | Date) => timeFormatter.format(typeof value === 'string' ? new Date(value) : value);
export const formatLongDate = (date: Date) => longDateFormatter.format(date);
export const formatShortDate = (date: Date) => shortDateFormatter.format(date);
export const formatWeekday = (date: Date) => weekdayFormatter.format(date);
export const formatFullDay = (date: Date) => fullDayFormatter.format(date);
export const formatMonthDay = (date: Date) => monthDayFormatter.format(date);
export const formatMonthYear = (date: Date) => monthYearFormatter.format(date);
export const formatMonth = (date: Date, style: 'short' | 'narrow' = 'short') =>
  (style === 'narrow' ? monthNarrowFormatter : monthShortFormatter).format(date);
export const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
