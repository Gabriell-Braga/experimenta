// @vitest-environment jsdom
import type { Envelope } from '@abtest/shared';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { startAgent } from './agent';
import { HOST_TAG } from './overlay';

const APP = 'http://localhost:5173';
const boot = { token: 't', appOrigin: APP, accountId: 'demo', apiUrl: 'http://api' };

let posted: { msg: Envelope; origin: string }[];
let parent: Window;
let agent: ReturnType<typeof startAgent>;

beforeEach(() => {
  document.body.innerHTML = `
    <main id="main"><section class="hero"><h1 id="t">Título</h1><a href="/x" class="btn">Ir</a></section></main>`;
  posted = [];
  parent = {
    postMessage: (msg: Envelope, origin: string) => posted.push({ msg, origin }),
  } as unknown as Window;
  agent = startAgent(window, boot, parent);
});
afterEach(() => agent.destroy());

const events = (name: string) =>
  posted
    .filter((p) => p.msg.kind === 'evt' && p.msg.event === name)
    .map((p) => (p.msg as { payload: unknown }).payload);
const shadow = () => document.querySelector(HOST_TAG)!.shadowRoot!;
/** Chama um método do agent como o app faria. */
async function call(method: string, params: object) {
  const id = `r${Math.random()}`;
  window.dispatchEvent(
    Object.assign(new Event('message'), {
      data: { abt: 1, kind: 'req', id, method, params },
      origin: APP,
      source: parent,
    }),
  );
  await vi.waitFor(() => expect(posted.some((p) => p.msg.kind === 'res' && p.msg.id === id)).toBe(true));
  return posted.find((p) => p.msg.kind === 'res' && p.msg.id === id)!.msg as { ok: boolean; result: unknown };
}

describe('agent: hover, seleção e breadcrumb', () => {
  test('emite ready para o pai com origin exato do app', () => {
    expect(events('ready')).toHaveLength(1);
    expect(posted.every((p) => p.origin === APP)).toBe(true);
  });

  test('overlay fica num Shadow DOM fora do body', () => {
    const host = document.querySelector(HOST_TAG)!;
    expect(host.parentElement).toBe(document.documentElement);
    expect(host.shadowRoot!.querySelector('style')!.textContent).toContain(':host{all:initial');
  });

  test('hover mostra label do elemento', () => {
    document.querySelector('h1')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const label = shadow().querySelector('.hover-label') as HTMLElement;
    expect(label.style.display).toBe('block');
    expect(label.textContent).toBe('h1#t');
  });

  test('clique seleciona, bloqueia o site e envia ElementInfo', () => {
    const siteHandler = vi.fn();
    document.querySelector('a')!.addEventListener('click', siteHandler);
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.querySelector('a')!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(siteHandler).not.toHaveBeenCalled();
    const info = events('selected').at(-1) as {
      tag: string;
      target: { selector: string };
      breadcrumb: { label: string }[];
    };
    expect(info.tag).toBe('a');
    expect(info.target.selector).toBe('a[href="/x"]');
    expect(info.breadcrumb.map((b) => b.label)).toEqual(['section.hero', 'main#main', 'body']);
    expect((shadow().querySelector('.sel-label') as HTMLElement).textContent).toBe('a.btn');
  });

  test('breadcrumb seleciona ancestral', () => {
    document.querySelector('h1')!.click();
    const crumbs = [...shadow().querySelectorAll('.crumbs button')] as HTMLButtonElement[];
    expect(crumbs.map((b) => b.textContent)).toEqual(['body', 'main#main', 'section.hero', 'h1#t']);
    crumbs[2]!.click();
    expect(agent.selected).toBe(document.querySelector('section'));
    expect((events('selected').at(-1) as { tag: string }).tag).toBe('section');
  });

  test('modo navegar não intercepta cliques; métodos select/highlight do app', async () => {
    expect((await call('setMode', { mode: 'browse' })).ok).toBe(true);
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.querySelector('h1')!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    await call('setMode', { mode: 'edit' });
    const r = await call('select', { selector: '#t' });
    expect((r.result as { tag: string }).tag).toBe('h1');
    expect(agent.selected).toBe(document.querySelector('#t'));
    expect((await call('highlight', { selector: '.btn' })).result).toEqual({ found: true });
    expect((await call('highlight', { selector: '.nada' })).result).toEqual({ found: false });
  });

  test('applyVariation aplica, reverte a anterior e informa falhas', async () => {
    const op = (id: string, value: string, selector = '#t') => ({
      id,
      order: 0,
      type: 'setText',
      target: { selector },
      value,
    });
    let r = await call('applyVariation', { operations: [op('o1', 'A')], customCSS: 'h1{color:red}' });
    expect(r.result).toEqual({ applied: [{ id: 'o1', via: 'primary' }], failed: [] });
    expect(document.querySelector('#t')!.textContent).toBe('A');
    expect(document.querySelector('style[data-abt-css]')!.textContent).toBe('h1{color:red}');
    r = await call('applyVariation', { operations: [] });
    expect(document.querySelector('#t')!.textContent).toBe('Título');
    expect(document.querySelector('style[data-abt-css]')).toBeNull();
  });
});

describe('agent: edição inline e menu de contexto', () => {
  const drafts = () =>
    events('operation').map((p) => (p as { draft: { type: string; value?: unknown } }).draft);

  test('duplo clique edita texto; Enter confirma emitindo setText e restaura o DOM', () => {
    const h1 = document.querySelector('h1')!;
    h1.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    expect(h1.getAttribute('contenteditable')).toBe('true');
    // Clique dentro do texto em edição não é bloqueado (cursor) nem vira seleção.
    const inside = new MouseEvent('click', { bubbles: true, cancelable: true });
    h1.dispatchEvent(inside);
    expect(inside.defaultPrevented).toBe(false);
    h1.textContent = 'Novo título';
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(h1.hasAttribute('contenteditable')).toBe(false);
    expect(h1.textContent).toBe('Título'); // volta ao original; a variação reaplicada mostra o novo
    expect(drafts()).toEqual([
      expect.objectContaining({
        type: 'setText',
        value: 'Novo título',
        target: expect.objectContaining({ selector: '#t' }),
      }),
    ]);
  });

  test('Esc cancela e texto igual não gera operação', () => {
    const h1 = document.querySelector('h1')!;
    agent.editing.startEdit(h1);
    h1.textContent = 'x';
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    agent.editing.startEdit(h1);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(h1.textContent).toBe('Título');
    expect(drafts()).toEqual([]);
  });

  test('elemento com filhos vira setHTML', () => {
    const section = document.querySelector('section')!;
    agent.editing.startEdit(section);
    section.querySelector('h1')!.textContent = 'Mudou';
    agent.editing.finishEdit(true);
    expect(drafts()[0]).toMatchObject({ type: 'setHTML' });
    expect((drafts()[0]!.value as string).includes('Mudou')).toBe(true);
  });

  test('menu de contexto: esconder, remover, inserir (pede HTML ao app), copiar seletor, selecionar pai', async () => {
    const a = document.querySelector('a')!;
    const menu = () => shadow().querySelector('.menu') as HTMLElement;
    const open = () =>
      a.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }),
      );
    const pick = (id: string) => (menu().querySelector(`[data-action="${id}"]`) as HTMLButtonElement).click();
    open();
    expect(menu().style.display).toBe('flex');
    expect([...menu().querySelectorAll('button')].map((b) => b.dataset.action)).toEqual([
      'edit',
      'hide',
      'remove',
      'insert-before',
      'insert-after',
      'copy',
      'parent',
    ]);
    pick('hide');
    expect(menu().style.display).toBe('none');
    open();
    pick('remove');
    expect(drafts().map((d) => d.type)).toEqual(['hide', 'remove']);

    open();
    pick('insert-after');
    await vi.waitFor(() =>
      expect(posted.some((p) => p.msg.kind === 'req' && p.msg.method === 'prompt')).toBe(true),
    );
    const req = posted.find((p) => p.msg.kind === 'req')!.msg as { id: string };
    window.dispatchEvent(
      Object.assign(new Event('message'), {
        data: { abt: 1, kind: 'res', id: req.id, ok: true, result: '<p>novo</p>' },
        origin: APP,
        source: parent,
      }),
    );
    await vi.waitFor(() => expect(drafts()).toHaveLength(3));
    expect(drafts()[2]).toMatchObject({
      type: 'insertHTML',
      value: { position: 'after', html: '<p>novo</p>' },
    });

    open();
    pick('copy');
    await vi.waitFor(() =>
      expect((shadow().querySelector('.toast') as HTMLElement).textContent).toContain('a[href="/x"]'),
    );

    open();
    pick('parent');
    expect(agent.selected).toBe(document.querySelector('section'));
  });

  test('imagem: menu tem trocar imagem e não tem editar texto', () => {
    document.body.insertAdjacentHTML('beforeend', '<img id="img" src="/a.png">');
    document
      .querySelector('#img')!
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    const actions = [...shadow().querySelectorAll('.menu button')].map(
      (b) => (b as HTMLElement).dataset.action,
    );
    expect(actions).toContain('image');
    expect(actions).not.toContain('edit');
  });
});
