// CDN de teste começa vazia: publicações de execuções anteriores não vazam entre execuções.
import { rmSync } from 'node:fs';

rmSync(new URL('./.cdn', import.meta.url), { recursive: true, force: true });
