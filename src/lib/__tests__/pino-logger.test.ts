import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInfo = vi.fn();
const mockWarn = vi.fn();
const mockError = vi.fn();

vi.mock('pino', () => ({
  default: vi.fn(() => ({
    info: mockInfo,
    warn: mockWarn,
    error: mockError,
  })),
}));

describe('pino-logger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should log info with message and context', async () => {
    const { createPinoLogger } = await import('../pino-logger');
    const { getLogger } = await import('../logger');

    createPinoLogger();
    const log = getLogger();
    log.info('test message', { key: 'value' });

    expect(mockInfo).toHaveBeenCalledWith({ key: 'value' }, 'test message');
  });

  it('should log warn with message and context', async () => {
    const { createPinoLogger } = await import('../pino-logger');
    const { getLogger } = await import('../logger');

    createPinoLogger();
    const log = getLogger();
    log.warn('warning', { code: 500 });

    expect(mockWarn).toHaveBeenCalledWith({ code: 500 }, 'warning');
  });

  it('should log error with error object', async () => {
    const { createPinoLogger } = await import('../pino-logger');
    const { getLogger } = await import('../logger');

    createPinoLogger();
    const log = getLogger();
    const err = new Error('boom');
    log.error('something failed', err, { detail: 1 });

    expect(mockError).toHaveBeenCalledWith({ err, detail: 1 }, 'something failed');
  });
});
