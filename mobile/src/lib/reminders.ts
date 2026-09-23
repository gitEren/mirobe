import type { GarmentRow } from '@mirobe/shared';
import { upper, type Lang, type Strings } from './i18n';

/** Local hour of the daily reminder, in whatever time zone the phone is in at the time. */
export const REMINDER_HOUR = 15;
/** Days scheduled ahead. Every launch and return to the app moves the window forward. */
export const REMINDER_DAYS = 14;
/** Identifier prefix of the scheduled reminders; the local date follows. */
export const REMINDER_ID_PREFIX = 'mirobe-daily-';

export interface DailyReminder {
  /** mirobe-daily-YYYY-MM-DD: scheduling a day again replaces its reminder. */
  id: string;
  year: number;
  /** 1–12. */
  month: number;
  day: number;
  /** The same moment as a Date, in the current time zone. */
  date: Date;
  title: string;
  body: string;
  /** Opened on tap: Jev with the question typed in, not sent. */
  url: string;
}

type Theme = { title: string; body: string; ask: string };

/** Turkish letters, or a common Turkish garment, colour or fabric word. */
const TURKISH =
  /[çğıöşüÇĞİÖŞÜ]|\b(ceket|elbise|etek|kazak|mont|kaban|bot|kot|bluz|palto|kemer|yelek|lacivert|siyah|beyaz|mavi|gri|bej|krem|bordo|pembe|mor|haki|taba|ekru|keten|deri|pamuk|kadife|kareli|desenli|uzun|kolsuz)\b/i;

const lower = (text: string, lang: Lang) => (lang === 'tr' ? text.replace(/I/g, 'ı').replace(/İ/g, 'i') : text).toLowerCase();
const capitalize = (text: string, lang: Lang) => upper(text.charAt(0), lang) + text.slice(1);

/**
 * How a garment is named inside a sentence ("Lacivert Blazer Ceket" → "lacivert blazer ceket"),
 * or null when its name would read badly: missing, too long, or in the other language
 * (names are written in the language the app had when the garment was tagged).
 */
export function garmentMention(garment: GarmentRow, lang: Lang): string | null {
  const name = garment.name.trim().replace(/\s+/g, ' ');
  if (name.length < 3 || name.length > 36 || name.split(' ').length > 5) return null;
  if (TURKISH.test(name) !== (lang === 'tr')) return null;
  // An all-caps word (a brand, "NY") keeps the name as it was written.
  const acronym = name.split(' ').some((word) => /[A-ZÇĞİÖŞÜ]{2}/.test(word) && word === word.toUpperCase());
  return acronym ? name : lower(name, lang);
}

/**
 * Garments a reminder can mention, in a stable order so a day keeps its text while
 * the wardrobe is unchanged. Favourites only, when there are enough of them.
 */
export function reminderGarments(garments: GarmentRow[], lang: Lang): string[] {
  const named = garments
    .filter((garment) => !garment.deletedAt && garment.taggingStatus === 'ready')
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((garment) => ({ favorite: garment.favorite, mention: garmentMention(garment, lang) }))
    .filter((entry): entry is { favorite: boolean; mention: string } => entry.mention !== null);
  const favorites = named.filter((entry) => entry.favorite);
  const pool = favorites.length >= 3 ? favorites : named;
  return [...new Set(pool.map((entry) => entry.mention))];
}

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * The next `days` daily reminders at 15:00 local time. The app is open while this runs,
 * so today counts as visited and the first reminder is tomorrow's. Texts rotate by date:
 * Sunday looks ahead to Monday; Monday, Friday and Saturday have their own opener; a
 * garment from the wardrobe is worked in on those days and on every other weekday.
 */
export function buildDailyReminders({
  now,
  garments,
  lang,
  strings,
  days = REMINDER_DAYS,
}: {
  now: Date;
  garments: GarmentRow[];
  lang: Lang;
  strings: Strings['reminders'];
  days?: number;
}): DailyReminder[] {
  const mentions = reminderGarments(garments, lang);
  const themes = strings.weekday as Partial<Record<number, Theme>>;
  const reminders: DailyReminder[] = [];
  for (let offset = 1; offset <= days; offset += 1) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, REMINDER_HOUR, 0, 0, 0);
    const [year, month, day, weekday] = [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getDay()];
    // Days since the epoch for this calendar date: the rotation index, independent of DST.
    const dayNumber = Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
    const theme = themes[weekday];
    const item = mentions.length > 0 ? mentions[dayNumber % mentions.length] : null;
    const personal = item !== null && weekday !== 0 && (theme !== undefined || dayNumber % 2 === 0);

    let text: Theme;
    if (personal) {
      text = {
        title: theme?.title ?? strings.personalTitles[Math.floor(dayNumber / 2) % strings.personalTitles.length],
        body: strings.personal[dayNumber % strings.personal.length](item, capitalize(item, lang)),
        ask: strings.askWith(item),
      };
    } else if (theme) {
      text = theme;
    } else {
      text = { ...strings.generic[dayNumber % strings.generic.length], ask: strings.ask };
    }

    reminders.push({
      id: `${REMINDER_ID_PREFIX}${year}-${pad(month)}-${pad(day)}`,
      year,
      month,
      day,
      date,
      title: text.title,
      body: text.body,
      url: `mirobe:///stylist?prefill=${encodeURIComponent(text.ask)}`,
    });
  }
  return reminders;
}
