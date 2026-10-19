// Entrada do engage.js. O snippet carrega este arquivo só quando há campanhas publicadas (window.__ABT_ENGAGE__).
import { startEngage } from './campaigns';

const boot = window.__ABT_ENGAGE__;
if (boot) startEngage(window, boot);
