import path from "node:path";
import sqlite3 from "sqlite3";

export const normalizeDictionaryWord = (word: string) =>
  word.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

export class BilingualStore {
  private databases = new Map<BilingualDirection, Promise<sqlite3.Database>>();

  constructor(private directory: string) {}

  private open(direction: BilingualDirection) {
    if (direction !== "en-vi" && direction !== "vi-en") {
      throw new Error("Unsupported dictionary direction");
    }
    if (!this.databases.has(direction)) {
      const opening = new Promise<sqlite3.Database>((resolve, reject) => {
        const db = new sqlite3.Database(
          path.join(this.directory, `${direction}.sqlite`),
          sqlite3.OPEN_READONLY,
          (error) => error ? reject(error) : resolve(db)
        );
      });
      this.databases.set(direction, opening);
      opening.catch(() => this.databases.delete(direction));
    }
    return this.databases.get(direction)!;
  }

  async lookup(direction: BilingualDirection, word: string): Promise<BilingualEntry[]> {
    if (typeof word !== "string" || word.length > 200) {
      throw new Error("Invalid dictionary query");
    }
    const normalized = normalizeDictionaryWord(word);
    if (!normalized) return [];
    const db = await this.open(direction);
    return new Promise((resolve, reject) => {
      db.get("SELECT data FROM entries WHERE word = ?", [normalized], (error, row: { data: string }) => {
        if (error) return reject(error);
        try {
          resolve(row ? JSON.parse(row.data) : []);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  async close() {
    const opened = [...this.databases.values()];
    this.databases.clear();
    await Promise.all(opened.map(async (promise) => {
      const db = await promise;
      return new Promise<void>((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
    }));
  }
}
