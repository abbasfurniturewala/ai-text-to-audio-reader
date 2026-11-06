import { bindReaderHover } from './readerText';
interface Pool { observer: IntersectionObserver; callbacks: Map<Element, (nearby: boolean) => void>; disposeHover(): void }
const pools = new WeakMap<Element, Pool>();

/** Share a viewport observer instead of allocating one per paragraph. */
export function observeReader(element: Element, callback: (nearby: boolean) => void) {
  const root = element.closest('.reader-scroll');
  if (!root) return () => {};
  let pool = pools.get(root);
  if (!pool) {
    const callbacks = new Map<Element, (nearby: boolean) => void>();
    const observer = new IntersectionObserver(entries => { for (const entry of entries) callbacks.get(entry.target)?.(entry.isIntersecting); }, { root, rootMargin: '1200px 0px' });
    pool = { callbacks, observer, disposeHover: bindReaderHover(root) }; pools.set(root, pool);
  }
  pool.callbacks.set(element, callback); pool.observer.observe(element);
  return () => {
    pool.callbacks.delete(element); pool.observer.unobserve(element);
    if (!pool.callbacks.size) { pool.observer.disconnect(); pool.disposeHover(); pools.delete(root); }
  };
}
