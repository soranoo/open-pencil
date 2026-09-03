export interface KvStore {
  set(key: string, value: string, ttlMs?: number): Promise<void>;
  get(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
}
