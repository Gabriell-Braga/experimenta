// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import { startAgent } from './agent';

test('emite ready para o pai com origin exato do app', () => {
  const postMessage = vi.fn();
  const win = Object.create(window, { parent: { value: { postMessage } } }) as Window;
  const boot = { token: 't', appOrigin: 'http://localhost:5173', accountId: 'demo', apiUrl: 'http://api' };
  const peer = startAgent(win, boot);
  expect(postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ abt: 1, kind: 'evt', event: 'ready' }),
    'http://localhost:5173',
  );
  peer.dispose();
});
