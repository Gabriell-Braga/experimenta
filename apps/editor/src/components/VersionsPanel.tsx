import { useEffect, useState } from 'react';
import { listVersions, restoreVersion, type VersionInfo } from '../api';

interface Props {
  experimentId: string;
  /** Há alterações não salvas (restaurar descarta). */
  dirty: boolean;
  /** Recarrega o experimento depois de restaurar. */
  onRestored(): void;
}

/** Cada salvamento é uma versão; restaurar grava a escolhida como nova versão (nada se perde). */
export function VersionsPanel({ experimentId, dirty, onRestored }: Props) {
  const [items, setItems] = useState<VersionInfo[] | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    listVersions(experimentId).then(setItems, (e: Error) => setError(e.message));
  }, [experimentId]);

  if (error) return <p className="p-3 text-sm text-red-600">{error}</p>;
  if (!items) return <p className="p-3 text-sm text-gray-500">Carregando…</p>;
  return (
    <div className="text-sm" data-testid="versions">
      {dirty && (
        <p className="bg-yellow-50 p-3 text-xs text-yellow-900">
          Há alterações não salvas: restaurar uma versão as descarta.
        </p>
      )}
      <ul className="divide-y divide-gray-100">
        {items.map((v, i) => (
          <li key={v.version} className="flex items-center justify-between px-3 py-2" data-testid="version">
            <span>
              <b>v{v.version}</b> {i === 0 && <span className="text-xs text-brand-700">(atual)</span>}
              <span className="block text-xs text-gray-500">
                {new Date(v.createdAt).toLocaleString('pt-BR')}
              </span>
            </span>
            {i > 0 &&
              (confirm === v.version ? (
                <button
                  className="rounded bg-orange-500 px-2 py-1 text-xs text-white"
                  data-testid="restore-confirm"
                  onClick={() =>
                    restoreVersion(experimentId, v.version).then(onRestored, (e: Error) =>
                      setError(e.message),
                    )
                  }
                >
                  Confirmar restauração
                </button>
              ) : (
                <button
                  className="text-xs text-orange-600 underline"
                  data-testid="restore"
                  onClick={() => setConfirm(v.version)}
                >
                  Restaurar
                </button>
              ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
