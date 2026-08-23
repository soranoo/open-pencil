export interface Storage {
  put(designId: string, bytes: Uint8Array): Promise<void>;
  get(designId: string): Promise<Uint8Array>;
  delete(designId: string): Promise<void>;
}
