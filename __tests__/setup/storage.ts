/**
 * Node 26 defines its own global `localStorage`/`sessionStorage` (undefined unless
 * --localstorage-file is set), which hides jsdom's. Give jsdom tests a working in-memory
 * Storage when the global one is missing.
 */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
}

if (typeof window !== "undefined") {
  for (const name of ["localStorage", "sessionStorage"] as const) {
    let works = false;
    try {
      works = typeof globalThis[name]?.getItem === "function";
    } catch {
      works = false;
    }
    if (!works) {
      const storage = new MemoryStorage();
      Object.defineProperty(globalThis, name, { value: storage, configurable: true, writable: true });
      Object.defineProperty(window, name, { value: storage, configurable: true, writable: true });
    }
  }
}
