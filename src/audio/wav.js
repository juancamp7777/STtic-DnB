// Codificador WAV (puro JS, testeable en Node): PCM de 16 bits, o { float: true } = coma flotante de 32 bits
// (formato 3, con cbSize y chunk "fact" como pide la especificación; lo que pasa de 0 dBFS no se recorta).
export function encodeWav(channels, sampleRate, { float = false } = {}) {
  if (float) return encodeWavFloat(channels, sampleRate);
  const numCh = channels.length;
  const len = channels[0].length;
  const bytesPerSample = 2;
  const dataSize = len * numCh * bytesPerSample;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const str = (o, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataSize, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, numCh, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * numCh * bytesPerSample, true);
  v.setUint16(32, numCh * bytesPerSample, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, dataSize, true);
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      let x = channels[ch][i];
      if (!Number.isFinite(x)) x = 0;
      x = Math.max(-1, Math.min(1, x));
      v.setInt16(o, x < 0 ? Math.round(x * 0x8000) : Math.round(x * 0x7fff), true);
      o += 2;
    }
  }
  return buf;
}

function encodeWavFloat(channels, sampleRate) {
  const numCh = channels.length;
  const len = channels[0].length;
  const dataSize = len * numCh * 4;
  const buf = new ArrayBuffer(58 + dataSize);
  const v = new DataView(buf);
  const str = (o, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 50 + dataSize, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 18, true);
  v.setUint16(20, 3, true); // IEEE float
  v.setUint16(22, numCh, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * numCh * 4, true);
  v.setUint16(32, numCh * 4, true);
  v.setUint16(34, 32, true);
  v.setUint16(36, 0, true); // cbSize
  str(38, 'fact');
  v.setUint32(42, 4, true);
  v.setUint32(46, len, true);
  str(50, 'data');
  v.setUint32(54, dataSize, true);
  let o = 58;
  for (let i = 0; i < len; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const x = channels[ch][i];
      v.setFloat32(o, Number.isFinite(x) ? x : 0, true);
      o += 4;
    }
  }
  return buf;
}

// Estadísticas de un render: pico, RMS, muestras rotas, clipping.
export function analyzeChannels(channels, sampleRate) {
  let peak = 0;
  let sum = 0;
  let nan = 0;
  let clipped = 0;
  let count = 0;
  let dc = 0;
  for (const d of channels) {
    for (let i = 0; i < d.length; i++) {
      const x = d[i];
      if (!Number.isFinite(x)) {
        nan++;
        continue;
      }
      const a = Math.abs(x);
      if (a > peak) peak = a;
      if (a >= 0.999) clipped++;
      sum += x * x;
      dc += x;
      count++;
    }
  }
  const rms = Math.sqrt(sum / Math.max(1, count));
  const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
  return {
    peak,
    peakDb: db(peak),
    rms,
    rmsDb: db(rms),
    nan,
    clipped,
    dc: dc / Math.max(1, count),
    seconds: channels[0].length / sampleRate,
  };
}
