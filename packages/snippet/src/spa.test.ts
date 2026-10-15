// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import { watchLocation } from './spa';

test('rota por hash (#/rota) e pushState avisam a mudança uma vez cada', async () => {
  const onChange = vi.fn();
  const stop = watchLocation(window, onChange);
  location.hash = '#/planos';
  await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.stringContaining('#/planos')));
  history.pushState(null, '', '/sobre');
  expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining('/sobre'));
  expect(onChange).toHaveBeenCalledTimes(2);
  stop();
});
