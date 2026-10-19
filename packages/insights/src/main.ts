// Entrada do insights.js. O snippet carrega este arquivo só para visitantes amostrados (window.__ABT_INSIGHTS__).
import { startForms } from './forms';
import { startRecorder } from './recorder';

const boot = window.__ABT_INSIGHTS__;
if (boot?.record) startRecorder(window, boot);
if (boot?.forms) startForms(window, boot);
// Marca que a captura começou (diagnóstico e testes: o bundle carrega de forma assíncrona).
if (boot) document.documentElement.dataset.abtInsights = 'on';
