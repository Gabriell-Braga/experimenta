// API pública do snippet usada nos testes (definida em packages/snippet/src/main.ts).
interface Window {
  abq?: { push(c: unknown[]): void } | unknown[];
  abt?: { visitorId: string; assignments(): Record<string, string>; flush(): void };
}
