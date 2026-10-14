import { useEffect, useRef } from 'react';

export interface PromptRequest {
  kind: 'html' | 'image';
  title: string;
  initial: string;
  resolve(v: string | null): void;
}

/** Diálogo nativo (<dialog>) para o agent pedir HTML ou URL de imagem ao usuário. */
export function PromptDialog({ req, onClose }: { req: PromptRequest | null; onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (req && !ref.current?.open) ref.current?.showModal();
  }, [req]);
  if (!req) return null;
  const finish = (v: string | null) => {
    req.resolve(v);
    ref.current?.close();
    onClose();
  };
  return (
    <dialog
      ref={ref}
      className="m-auto w-[32rem] rounded-xl p-0 shadow-2xl backdrop:bg-black/30"
      onCancel={() => finish(null)}
    >
      <form
        method="dialog"
        className="flex flex-col gap-3 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          finish(String(new FormData(e.currentTarget).get('value') ?? ''));
        }}
      >
        <h2 className="font-semibold">{req.title}</h2>
        {req.kind === 'html' ? (
          <textarea
            name="value"
            defaultValue={req.initial}
            rows={6}
            autoFocus
            className="rounded border p-2 font-mono text-sm"
            data-testid="prompt-input"
          />
        ) : (
          <input
            name="value"
            defaultValue={req.initial}
            autoFocus
            className="rounded border p-2 text-sm"
            data-testid="prompt-input"
          />
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => finish(null)} className="rounded px-3 py-1.5 text-sm">
            Cancelar
          </button>
          <button
            type="submit"
            className="rounded bg-orange-500 px-3 py-1.5 text-sm text-white"
            data-testid="prompt-ok"
          >
            OK
          </button>
        </div>
      </form>
    </dialog>
  );
}
