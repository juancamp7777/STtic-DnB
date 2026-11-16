// Análisis de un tema en un hilo aparte (lo usan el servidor y la CLI): un bucle infinito en el código
// del usuario no puede colgarlos; si tarda demasiado, el hilo se termina.
import { parentPort, workerData } from 'node:worker_threads';
import { analyzeSong, formatReport } from './analyze.js';

const { code, label } = typeof workerData === 'string' ? { code: workerData, label: '' } : workerData;

analyzeSong(code).then(
  (r) => parentPort.postMessage({ ok: r.ok, errors: r.errors, warnings: r.warnings, report: formatReport(r, label) }),
  (e) => {
    const msg = e && e.message ? e.message : String(e);
    parentPort.postMessage({ ok: false, errors: [msg], warnings: [], report: `✖ ${label}\n  ✖ ${msg}` });
  },
);
