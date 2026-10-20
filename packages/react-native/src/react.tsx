// Provider + hooks. Só usam React (nada de react-native), então rodam nos testes com react-dom.
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import type { Attributes, Decision, MobileClient } from './client';

const Ctx = createContext<MobileClient | null>(null);

/** Disponibiliza o cliente (criado uma vez, fora do componente) para os hooks. */
export function ExperimentaProvider({ client, children }: { client: MobileClient; children?: ReactNode }) {
  return <Ctx.Provider value={client}>{children}</Ctx.Provider>;
}

export function useExperimenta(): MobileClient {
  const c = useContext(Ctx);
  if (!c) throw new Error('useExperimenta: coloque o app dentro de <ExperimentaProvider client={...}>');
  return c;
}

/** Re-renderiza quando a config, o perfil ou o "pronto" mudam. */
const useRevision = (c: MobileClient) =>
  useSyncExternalStore(
    c.subscribe,
    () => c.revision,
    () => c.revision,
  );

/** `{ enabled, variables, ready }` da flag; false/{} até o SDK ficar pronto. */
export function useFlag(key: string, attributes?: Attributes) {
  const c = useExperimenta();
  const rev = useRevision(c);
  const a = JSON.stringify(attributes ?? {});
  return useMemo(
    () => ({
      enabled: c.isEnabled(key, attributes),
      variables: c.getVariables(key, attributes),
      ready: c.isReady,
    }),
    // atributos comparados pelo conteúdo (a), não pela identidade do objeto
    [c, rev, key, a],
  );
}

/** Variação da campanha (registra a exposição); null fora do tráfego ou até o SDK ficar pronto. */
export function useVariation(experimentKey: string): Decision | null {
  const c = useExperimenta();
  const rev = useRevision(c);
  return useMemo(() => c.getVariation(experimentKey), [c, rev, experimentKey]);
}
export const useExperiment = useVariation;

/** `track(evento, { value, props })` estável entre renders. */
export function useTrack(): MobileClient['track'] {
  const c = useExperimenta();
  return c.track;
}

/** Registra a tela ao montar (alternativa ao `onStateChange` do React Navigation). */
export function useScreen(name: string) {
  const c = useExperimenta();
  useEffect(() => c.screen(name), [c, name]);
}
