export function ffmpegProgress(listener) {
  let buffer = '', values = {};
  return data => {
    buffer += data.toString('utf8'); let at;
    while ((at = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, at).trim(); buffer = buffer.slice(at + 1);
      const split = line.indexOf('='), key = line.slice(0, split), value = line.slice(split + 1);
      if (split < 1) continue;
      if (['out_time_us', 'out_time_ms', 'speed', 'progress'].includes(key)) values[key] = value;
      if (key === 'progress') {
        const micros = Number(values.out_time_us ?? values.out_time_ms), speed = Number.parseFloat(values.speed);
        if (Number.isFinite(micros) && micros >= 0) listener({ seconds: micros / 1000000, ...(Number.isFinite(speed) && speed > 0 ? { speed } : {}), done: value === 'end' });
        values = {};
      }
    }
    if (buffer.length > 8192) buffer = '';
  };
}
export function encodingProgress(record, totalSeconds, elapsedSeconds, completedSeconds = 0) {
  const encodedSeconds = Math.max(0, Math.min(totalSeconds, record.seconds));
  const remainingSeconds = elapsedSeconds >= 2 && encodedSeconds > completedSeconds ? Math.max(0, (totalSeconds - encodedSeconds) * elapsedSeconds / (encodedSeconds - completedSeconds)) : undefined;
  return { phase: encodedSeconds >= totalSeconds - .25 ? 'indexing' : 'encoding', encodedSeconds, totalSeconds, percent: Math.min(99.9, encodedSeconds / Math.max(.001, totalSeconds) * 100), ...(remainingSeconds !== undefined ? { remainingSeconds } : {}) };
}
export function finishingProgress(previous, details, now = Date.now()) {
  const advanced = !previous || previous.phase !== details.phase || (details.encodedSeconds ?? 0) > (previous.encodedSeconds ?? 0);
  return { startedAt: previous?.startedAt ?? now, updatedAt: advanced ? now : previous.updatedAt, ...details };
}
