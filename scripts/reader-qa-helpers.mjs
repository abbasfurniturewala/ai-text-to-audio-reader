// Test real glyph coordinates, independent of the reader's word decorations.
export async function openMenu(page) {
  await page.locator('.app-shell').waitFor();
  if (!await page.getByRole('button', { name: 'Menu', exact: true }).count()) {
    const legacy = page.getByLabel('Show library sidebar', { exact: true }); if (await legacy.count()) await legacy.click(); return;
  }
  const menu = page.getByRole('dialog', { name: 'Main menu', exact: true });
  if (!await menu.isVisible()) await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await menu.waitFor();
}
export async function menuClick(locator) { await openMenu(locator.page()); await locator.click(); }

export async function readerWordPoint(passage, word = 0, occurrence = 0, edge = 'center') {
  await passage.scrollIntoViewIfNeeded();
  return passage.evaluate((element, options) => {
    const source = element.querySelector('[data-reader-text]') || element, text = source.textContent || '';
    const words = [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)].filter(part => part.isWordLike);
    const item = typeof options.word === 'number' ? words[options.word] : words.filter(part => part.segment === options.word)[options.occurrence];
    if (!item) throw new Error(`Word ${options.word} (${options.occurrence}) not found in ${text.slice(0, 100)}`);
    const start = item.index, end = start + item.segment.length, range = document.createRange();
    const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT); let offset = 0, began = false;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const length = node.textContent.length;
      if (!began && start <= offset + length) { range.setStart(node, start - offset); began = true; }
      if (began && end <= offset + length) { range.setEnd(node, end - offset); break; }
      offset += length;
    }
    let box = [...range.getClientRects()].find(box => box.width > 0) || range.getBoundingClientRect();
    const root = element.closest('.reader-scroll'), viewport = root?.getBoundingClientRect();
    let scrolled = false;
    if (root && (box.top < viewport.top + 90 || box.bottom > viewport.bottom - 10)) {
      const top = Math.max(0, Math.min(root.scrollHeight - root.clientHeight, root.scrollTop + box.top - viewport.top - 110));
      if (Math.abs(top - root.scrollTop) > .5) { root.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 1 })); root.scrollTo({ top, behavior: 'instant' }); box = range.getBoundingClientRect(); scrolled = true; }
    }
    return { start, end, text: item.segment, x: options.edge === 'right' ? box.right - .2 : box.left + box.width / 2, y: box.top + box.height / 2, scrolled };
  }, { word, occurrence, edge });
}
export async function clickReaderWord(passage, word = 0, occurrence = 0, edge = 'center') {
  let point = await readerWordPoint(passage, word, occurrence, edge);
  if (point.scrolled) { await passage.page().waitForTimeout(50); point = await readerWordPoint(passage, word, occurrence, edge); }
  await passage.page().mouse.click(point.x, point.y); return point;
}
export async function dispatchReaderWord(passage, word = 0, occurrence = 0) {
  const point = await readerWordPoint(passage, word, occurrence);
  await passage.evaluate((element, point) => element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: point.x, clientY: point.y })), point);
  return point;
}
export async function readerSpeechText(page) {
  return page.evaluate(() => [...(CSS.highlights.get('cadence-reading-speech') || [])].map(range => range.toString()));
}
export async function waitReaderSpeech(page) {
  await page.waitForFunction(() => (CSS.highlights.get('cadence-reading-speech')?.size || 0) > 0);
}
export async function readerSpeechStyle(page) {
  return page.evaluate(() => {
    const range = [...(CSS.highlights.get('cadence-reading-speech') || [])][0];
    if (!range) return;
    const style = getComputedStyle(range.startContainer.parentElement, '::highlight(cadence-reading-speech)');
    return { background: style.backgroundColor, decoration: style.textDecorationLine };
  });
}
export async function waitReaderWordVisible(passage, minGap, maxGap) {
  await passage.page().waitForFunction(({ element, minGap, maxGap }) => {
    const source = element.querySelector('[data-reader-text]') || element;
    const part = [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(source.textContent)].find(part => part.isWordLike);
    if (!part) return false;
    const node = document.createTreeWalker(source, NodeFilter.SHOW_TEXT).nextNode(), range = document.createRange();
    if (!node || node.textContent.length < part.index + part.segment.length) return false;
    range.setStart(node, part.index); range.setEnd(node, part.index + part.segment.length);
    const box = range.getBoundingClientRect(), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    const marker = element.closest('section')?.querySelector('.original-page-marker'), gap = marker ? element.getBoundingClientRect().top - marker.getBoundingClientRect().bottom : undefined;
    return !!hit && element.contains(hit) && (minGap === undefined || gap >= minGap) && (maxGap === undefined || gap < maxGap);
  }, { element: await passage.elementHandle(), minGap, maxGap });
}
