import { File, Paths } from 'expo-file-system';

/**
 * Photos taken on this device live in the documents folder. Rows store them as
 * `local:<path inside documents>`, because the absolute `file://` path changes
 * when iOS moves the app container (updates, reinstalls from backup). Rows
 * written before this keep absolute URIs; they are re-rooted on read.
 */
const PREFIX = 'local:';
const DOCUMENTS = '/Documents/';

export function isLocalPath(uri: string | null | undefined): uri is string {
  return Boolean(uri && (uri.startsWith(PREFIX) || uri.startsWith('file:')));
}

/** The form a row stores: relative to the documents folder when the file is inside it. */
export function toStoredPath(uri: string): string;
export function toStoredPath(uri: string | null): string | null;
export function toStoredPath(uri: string | null): string | null {
  if (!uri || !uri.startsWith('file:')) return uri;
  const documents = Paths.document.uri.endsWith('/') ? Paths.document.uri : `${Paths.document.uri}/`;
  if (uri.startsWith(documents)) return PREFIX + uri.slice(documents.length);
  const index = uri.lastIndexOf(DOCUMENTS);
  return index >= 0 ? PREFIX + uri.slice(index + DOCUMENTS.length) : uri;
}

/** A `file://` URI for a stored local path (relative, or an absolute one from an older container). */
export function resolveLocalUri(path: string): string {
  const stored = toStoredPath(path);
  return stored.startsWith(PREFIX) ? new File(Paths.document, stored.slice(PREFIX.length)).uri : stored;
}
