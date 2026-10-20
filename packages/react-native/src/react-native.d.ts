// Tipos mínimos do que o SDK usa do react-native (peerDependency; não instalado no monorepo para não puxar o
// runtime RN). No app, os tipos reais do react-native valem.
declare module 'react-native' {
  export const AppState: {
    addEventListener(type: 'change', listener: (state: string) => void): { remove(): void };
  };
  export const Platform: { OS: string; Version: string | number; isPad?: boolean };
  export const Dimensions: { get(dim: 'window' | 'screen'): { width: number; height: number } };
}
