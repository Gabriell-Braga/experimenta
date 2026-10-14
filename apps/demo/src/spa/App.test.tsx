// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, test } from 'vitest';
import { App } from './App';

test('rotas da SPA renderizam e usam classes geradas css-*', () => {
  const { container } = render(
    <MemoryRouter initialEntries={['/planos']}>
      <App />
    </MemoryRouter>,
  );
  expect(screen.getByRole('heading').textContent).toBe('Planos');
  expect(screen.getByRole('button', { name: 'Assinar' }).className).toMatch(/^css-[a-z0-9]+$/);
  expect(container.querySelectorAll('li')).toHaveLength(3);
});
