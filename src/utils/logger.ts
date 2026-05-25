import fs from 'node:fs';
import path from 'node:path';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levelOrder: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface LoggerOptions {
  /** Append JSONL output to this file in addition to stdout/stderr. */
  filePath?: string | null;
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const out: Record<string, unknown> = {
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack
    };
    const cause = (error as { cause?: unknown }).cause;
    if (cause !== undefined) {
      out.errorCause =
        cause instanceof Error
          ? { name: cause.name, message: cause.message, code: (cause as { code?: string }).code }
          : String(cause);
    }
    const code = (error as { code?: string }).code;
    if (code) {
      out.errorCode = code;
    }
    return out;
  }

  return {
    errorMessage: String(error)
  };
}

function withErrorMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) {
    return undefined;
  }
  if (!('error' in meta) || meta.error === undefined) {
    return meta;
  }
  return { ...meta, ...serializeError(meta.error) };
}

function openFileSink(filePath: string): fs.WriteStream | null {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const stream = fs.createWriteStream(filePath, { flags: 'a' });
    stream.on('error', (err) => {
      // Best-effort: write a single line to stderr so a broken sink isn't silent,
      // but never throw — logging must not crash the process.
      console.error(JSON.stringify({ level: 'error', message: 'log file sink error', errorMessage: err.message }));
    });
    return stream;
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'failed to open log file sink',
        filePath,
        errorMessage: err instanceof Error ? err.message : String(err)
      })
    );
    return null;
  }
}

export function createLogger(level: LogLevel, options: LoggerOptions = {}): Logger {
  const minLevelValue = levelOrder[level];
  const fileStream = options.filePath ? openFileSink(options.filePath) : null;

  function log(targetLevel: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (levelOrder[targetLevel] < minLevelValue) {
      return;
    }

    const payload = {
      ts: new Date().toISOString(),
      level: targetLevel,
      message,
      ...(meta ?? {})
    };

    const output = JSON.stringify(payload);

    if (fileStream) {
      // Best-effort, non-blocking. Backpressure is acceptable for this volume.
      fileStream.write(output + '\n');
    }

    if (targetLevel === 'error') {
      console.error(output);
      return;
    }

    if (targetLevel === 'warn') {
      console.warn(output);
      return;
    }

    console.log(output);
  }

  return {
    debug(message, meta) {
      log('debug', message, withErrorMeta(meta));
    },
    info(message, meta) {
      log('info', message, withErrorMeta(meta));
    },
    warn(message, meta) {
      log('warn', message, withErrorMeta(meta));
    },
    error(message, meta) {
      log('error', message, withErrorMeta(meta));
    }
  };
}
