// Stub do react-native para os testes (alias em vitest.config.ts).
type Listener = (state: string) => void;
const listeners = new Set<Listener>();
export const AppState = {
  addEventListener(_type: 'change', l: Listener) {
    listeners.add(l);
    return { remove: () => void listeners.delete(l) };
  },
  /** Só nos testes: simula a troca de estado do app. */
  emit: (s: string) => listeners.forEach((l) => l(s)),
};
export const Platform = { OS: 'ios', Version: '17.4', isPad: false };
export const Dimensions = { get: () => ({ width: 390, height: 844 }) };
