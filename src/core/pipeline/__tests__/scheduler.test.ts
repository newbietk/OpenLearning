import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createScheduler } from '../scheduler';

describe('scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should register and schedule URL sync jobs', () => {
    const scheduler = createScheduler({ defaultIntervalMs: 3600000 });
    const callback = vi.fn();

    scheduler.register('doc-1', 'https://example.com', callback);
    expect(scheduler.jobs.size).toBe(1);

    scheduler.start();
    vi.advanceTimersByTime(3600001);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should not stop other jobs when one fails', () => {
    const scheduler = createScheduler({ defaultIntervalMs: 1000 });
    const goodCallback = vi.fn();
    const badCallback = vi.fn(() => { throw new Error('boom'); });

    scheduler.register('doc-1', 'https://good.example.com', goodCallback);
    scheduler.register('doc-2', 'https://bad.example.com', badCallback);

    scheduler.start();
    vi.advanceTimersByTime(1001);

    expect(badCallback).toHaveBeenCalled();
    expect(goodCallback).toHaveBeenCalled();
  });

  it('should stop all jobs', () => {
    const scheduler = createScheduler({ defaultIntervalMs: 500 });
    const callback = vi.fn();
    scheduler.register('doc-1', 'https://example.com', callback);
    scheduler.start();
    scheduler.stop();
    vi.advanceTimersByTime(1000);
    expect(callback).not.toHaveBeenCalled();
  });

  it('should unregister a job', () => {
    const scheduler = createScheduler({ defaultIntervalMs: 500 });
    const callback = vi.fn();
    scheduler.register('doc-1', 'https://example.com', callback);
    scheduler.unregister('doc-1');
    scheduler.start();
    vi.advanceTimersByTime(1000);
    expect(callback).not.toHaveBeenCalled();
  });
});
