/**
 * File-backed ConversationStore.
 *
 * Each conversation is a single JSON file in <baseDir>/<id>.json.
 * Thread-safe enough for a single-server dev setup; swap for a DB when
 * scaling to multiple processes or users.
 */

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ConversationEvent,
  ConversationRecord,
  ConversationStore,
  ConversationSummary,
  NewConversationEvent
} from "./types.js";

type PersistedConversation = {
  conversation: ConversationRecord;
  events: ConversationEvent[];
  nextSeq: number;
};

function makeId(): string {
  return crypto.randomUUID();
}

function sanitizeFileName(id: string): string {
  return id.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
}

export class FileConversationStore implements ConversationStore {
  constructor(private readonly baseDir: string) {}

  private async ensureDir(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
  }

  private filePath(id: string): string {
    return join(this.baseDir, `${sanitizeFileName(id)}.json`);
  }

  private async read(id: string): Promise<PersistedConversation | null> {
    try {
      const raw = await readFile(this.filePath(id), "utf8");
      return JSON.parse(raw) as PersistedConversation;
    } catch {
      return null;
    }
  }

  private async write(id: string, data: PersistedConversation): Promise<void> {
    await this.ensureDir();
    await writeFile(this.filePath(id), JSON.stringify(data, null, 2), "utf8");
  }

  // ---- ConversationStore implementation ----

  async create(title = "New conversation"): Promise<ConversationRecord> {
    const id = makeId();
    const now = new Date().toISOString();
    const record: ConversationRecord = {
      id,
      title,
      createdAt: now,
      updatedAt: now
    };
    await this.write(id, { conversation: record, events: [], nextSeq: 1 });
    return record;
  }

  async get(id: string): Promise<ConversationRecord | null> {
    return (await this.read(id))?.conversation ?? null;
  }

  async list(): Promise<ConversationSummary[]> {
    await this.ensureDir();
    const files = await readdir(this.baseDir);
    const summaries: ConversationSummary[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(this.baseDir, file), "utf8");
        const { conversation } = JSON.parse(raw) as PersistedConversation;
        summaries.push({
          id: conversation.id,
          title: conversation.title,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt
        });
      } catch {
        // skip corrupt files
      }
    }

    return summaries.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  async appendEvents(
    conversationId: string,
    events: NewConversationEvent[]
  ): Promise<ConversationEvent[]> {
    if (events.length === 0) return [];

    const persisted = await this.read(conversationId);
    if (!persisted) throw new Error(`Conversation ${conversationId} not found`);

    const now = new Date().toISOString();
    const appended: ConversationEvent[] = events.map(ev => ({
      id: makeId(),
      conversationId,
      seq: persisted.nextSeq++,
      type: ev.type,
      role: ev.role,
      content: ev.content,
      createdAt: now
    }));

    persisted.events.push(...appended);
    persisted.conversation.updatedAt = now;
    await this.write(conversationId, persisted);
    return appended;
  }

  async getEvents(conversationId: string): Promise<ConversationEvent[]> {
    return (await this.read(conversationId))?.events ?? [];
  }

  async purgeOlderThan(maxAgeDays: number): Promise<number> {
    await this.ensureDir();
    const cutoff = Date.now() - maxAgeDays * 86_400_000;
    const files = await readdir(this.baseDir);
    let deleted = 0;

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(this.baseDir, file), "utf8");
        const { conversation } = JSON.parse(raw) as PersistedConversation;
        if (new Date(conversation.updatedAt).getTime() < cutoff) {
          await rm(join(this.baseDir, file));
          deleted++;
        }
      } catch {
        // skip
      }
    }

    return deleted;
  }

  async delete(id: string): Promise<boolean> {
    try {
      await rm(this.filePath(id));
      return true;
    } catch {
      return false;
    }
  }
}
