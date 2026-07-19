import { watch, type FSWatcher } from "node:fs";

export interface DebouncedFileWatchOptions {
  path: string;
  debounceMs?: number;
  onChange: () => void;
  onError?: (error: Error) => void;
}

/**
 * Watches a single file for changes and invokes onChange after a debounce
 * window. rename events use a longer settle window because atomic
 * tmp+rename writers produce a rename burst before the file stabilizes.
 * Missing files are tolerated: no watcher is attached until the caller
 * retries via arm().
 */
export class DebouncedFileWatch {
  private readonly path: string;
  private readonly debounceMs: number;
  private readonly onChange: () => void;
  private readonly onError?: (error: Error) => void;
  private watcher: FSWatcher | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(options: DebouncedFileWatchOptions) {
    this.path = options.path;
    this.debounceMs = options.debounceMs ?? 100;
    this.onChange = options.onChange;
    this.onError = options.onError;
    this.arm();
  }

  arm(): void {
    if (this.closed || this.watcher) {
      return;
    }
    try {
      this.watcher = watch(this.path, (eventType) => {
        this.schedule(eventType === "rename" ? this.debounceMs * 2 : this.debounceMs);
      });
      this.watcher.on("error", (error) => {
        this.onError?.(error);
        this.unarm();
      });
    } catch (error) {
      this.watcher = null;
      if (error instanceof Error) {
        this.onError?.(error);
      }
    }
  }

  private schedule(delayMs: number): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.closed) {
        this.onChange();
      }
    }, delayMs);
  }

  private unarm(): void {
    this.watcher?.close();
    this.watcher = null;
  }

  close(): void {
    this.closed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.unarm();
  }
}
