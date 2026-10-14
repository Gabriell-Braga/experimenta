// Entrada do bundle publicado (dist/abt.js). Precisa rodar de forma síncrona no <head>.
import { readConfig } from './config';
import { start } from './runtime';

const config = readConfig();
if (config) start(window, config);
