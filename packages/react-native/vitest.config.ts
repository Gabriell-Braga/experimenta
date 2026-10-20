import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// O runtime do React Native não roda no Node: os testes usam um stub de AppState/Platform/Dimensions.
export default defineConfig({
  resolve: {
    alias: { 'react-native': fileURLToPath(new URL('./test/react-native-stub.ts', import.meta.url)) },
  },
});
