import { useCallback, useEffect, useRef, useState } from 'react';

/** One deadline timer, rather than a React render for every mouse movement. */
export function useIdlePlayer(resetKey: string, beforeChange: () => void) {
  const [visible, setVisible] = useState(true);
  const [manualHidden, setManualHidden] = useState(false);
  const visibleRef = useRef(true);
  const manual = useRef(false), wake = useRef(() => {});
  const before = useRef(beforeChange);
  before.current = beforeChange;
  const change = useCallback((value: boolean) => {
    if (visibleRef.current === value) return;
    before.current(); visibleRef.current = value; setVisible(value);
  }, []);
  const hide = useCallback(() => { manual.current = true; setManualHidden(true); change(false); }, [change]);
  const show = useCallback(() => wake.current(), []);
  useEffect(() => {
    let lastActivity = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let holdingControl = false;
    const check = () => {
      timer = undefined;
      if (manual.current) return;
      const remaining = 10000 - (Date.now() - lastActivity);
      if (remaining > 0) timer = setTimeout(check, remaining);
      else if (!holdingControl) change(false);
    };
    const activity = () => {
      if (manual.current) return;
      lastActivity = Date.now(); change(true);
      if (timer === undefined) timer = setTimeout(check, 10000);
    };
    const down = (event: PointerEvent) => {
      holdingControl = event.target instanceof Element && !!event.target.closest('.player');
      activity();
    };
    const release = () => { holdingControl = false; activity(); };
    const activate = () => { if (manual.current) { manual.current = false; setManualHidden(false); } activity(); };
    const click = (event: MouseEvent) => { if (!(event.target instanceof Element && event.target.closest('.player-reveal'))) activate(); };
    const keyboard = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest('.player-reveal') && ['Enter', ' '].includes(event.key)) return;
      if (!manual.current || !event.repeat && !['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) activate();
    };
    wake.current = activate;
    activity();
    window.addEventListener('pointermove', activity, { passive: true });
    window.addEventListener('pointerdown', down, { passive: true });
    window.addEventListener('pointerup', release, { passive: true });
    window.addEventListener('pointercancel', release, { passive: true });
    window.addEventListener('wheel', activity, { passive: true });
    window.addEventListener('click', click, true);
    window.addEventListener('keydown', keyboard);
    window.addEventListener('focus', release);
    window.addEventListener('blur', release);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', activity);
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      window.removeEventListener('wheel', activity);
      window.removeEventListener('click', click, true);
      window.removeEventListener('keydown', keyboard);
      window.removeEventListener('focus', release);
      window.removeEventListener('blur', release);
    };
  }, [resetKey, change]);
  return { visible, manualHidden, hide, show };
}
