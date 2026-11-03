import { useEffect, useRef, useState } from 'react';

/** One deadline timer, rather than a React render for every mouse movement. */
export function useIdlePlayer(resetKey: string, beforeChange: () => void) {
  const [visible, setVisible] = useState(true);
  const visibleRef = useRef(true);
  const before = useRef(beforeChange);
  before.current = beforeChange;
  useEffect(() => {
    let lastActivity = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let holdingControl = false;
    const change = (value: boolean) => {
      if (visibleRef.current === value) return;
      before.current(); visibleRef.current = value; setVisible(value);
    };
    const check = () => {
      timer = undefined;
      const remaining = 10000 - (Date.now() - lastActivity);
      if (remaining > 0) timer = setTimeout(check, remaining);
      else if (!holdingControl) change(false);
    };
    const activity = () => {
      lastActivity = Date.now(); change(true);
      if (timer === undefined) timer = setTimeout(check, 10000);
    };
    const down = (event: PointerEvent) => {
      holdingControl = event.target instanceof Element && !!event.target.closest('.player');
      activity();
    };
    const release = () => { holdingControl = false; activity(); };
    activity();
    window.addEventListener('pointermove', activity, { passive: true });
    window.addEventListener('pointerdown', down, { passive: true });
    window.addEventListener('pointerup', release, { passive: true });
    window.addEventListener('pointercancel', release, { passive: true });
    window.addEventListener('wheel', activity, { passive: true });
    window.addEventListener('keydown', activity);
    window.addEventListener('focus', release);
    window.addEventListener('blur', release);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', activity);
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      window.removeEventListener('wheel', activity);
      window.removeEventListener('keydown', activity);
      window.removeEventListener('focus', release);
      window.removeEventListener('blur', release);
    };
  }, [resetKey]);
  return visible;
}
