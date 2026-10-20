// Gera dist/index.js (ESM) para o Metro: react, react-native e AsyncStorage ficam de fora (peerDependencies).
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2020',
  jsx: 'automatic',
  mainFields: ['module', 'main'],
  external: ['react', 'react/jsx-runtime', 'react-native', '@react-native-async-storage/async-storage'],
  outfile: 'dist/index.js',
  legalComments: 'none',
});
console.log('[react-native] dist/index.js');
