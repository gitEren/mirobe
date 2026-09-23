import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db/index';
import { HttpError } from './http';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
};

export interface StoredMedia {
  id: string;
  url: string;
  mimeType: string;
}

/**
 * Local-disk media store. Ids are 144-bit random, so `/media/<id>` URLs act as
 * capability links. Swap this class for an R2/S3 adapter with the same surface
 * when the server moves to multiple instances.
 */
export class MediaStorage {
  readonly dir: string;

  constructor(
    private db: Db,
    dataDir: string
  ) {
    this.dir = path.join(dataDir, 'media');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  save(userId: string, buffer: Buffer, mimeType: string): StoredMedia {
    const extension = EXTENSIONS[mimeType];
    if (!extension) throw new HttpError(415, `Unsupported media type ${mimeType}`);
    const id = crypto.randomBytes(18).toString('base64url');
    const fileName = `${id}.${extension}`;
    fs.writeFileSync(path.join(this.dir, fileName), buffer);
    this.db
      .prepare('INSERT INTO media (id, user_id, file_name, mime_type, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, userId, fileName, mimeType, buffer.length, new Date().toISOString());
    return { id, url: `/media/${fileName}`, mimeType };
  }

  saveDataUrl(userId: string, dataUrl: string): StoredMedia {
    const { buffer, mimeType } = decodeDataUrl(dataUrl);
    return this.save(userId, buffer, mimeType);
  }

  /** Resolves a `/media/<file>` URL owned by the user to its bytes. */
  read(userId: string, url: string): { buffer: Buffer; mimeType: string } {
    const fileName = path.basename(url.split('?')[0]);
    const row = this.db
      .prepare('SELECT file_name, mime_type FROM media WHERE file_name = ? AND user_id = ?')
      .get(fileName, userId) as { file_name: string; mime_type: string } | undefined;
    if (!row) throw new HttpError(404, 'Media not found');
    return { buffer: fs.readFileSync(path.join(this.dir, row.file_name)), mimeType: row.mime_type };
  }

  /** Best effort: removes files whose media rows are already gone. A file that cannot be removed is only logged. */
  removeFiles(fileNames: string[]) {
    for (const fileName of fileNames) {
      try {
        fs.rmSync(path.join(this.dir, path.basename(fileName)), { force: true });
      } catch (error) {
        console.warn(`[mirobe] could not remove media ${fileName}: ${(error as Error).message}`);
      }
    }
  }

  readAsDataUrl(userId: string, url: string): string {
    const { buffer, mimeType } = this.read(userId, url);
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  }
}

export function decodeDataUrl(value: string): { buffer: Buffer; mimeType: string } {
  const match = value.match(/^data:([^;,]+);base64,(.+)$/s);
  if (!match) throw new HttpError(400, 'Expected a base64 data URL');
  return { mimeType: match[1], buffer: Buffer.from(match[2], 'base64') };
}
