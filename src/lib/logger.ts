export interface Logger {
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, err?: Error, ctx?: Record<string, unknown>): void;
}

let _logger: Logger = console as unknown as Logger;

export function setLogger(logger: Logger): void {
  _logger = logger;
}

export function getLogger(): Logger {
  return _logger;
}
