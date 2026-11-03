import { describe, expect, it } from 'vitest';
import { pdfParagraphs, repairLegacyParagraphs, splitText } from '../src/paragraphs';

describe('logical paragraphs', () => {
  it('retains a long paragraph and explicit paragraph breaks', () => {
    const paragraph = 'A complete sentence with room to breathe. '.repeat(25).trim();
    expect(splitText(paragraph + '\n\nAnother paragraph.').map(segment => segment.text)).toEqual([paragraph, 'Another paragraph.']);
  });
  it('uses real line spacing, tolerates rounding, and keeps unfinished short lines', () => {
    const text = [
      'The previous paragraph ends.',
      "Charlie's formal education began at Dundee Elementary School where he",
      'and his younger sisters, Nancy and Carol, were indoctrinated with ethical',
      'homilies. His parents encouraged reading',
      'and gave each child books to read.',
      'A separate paragraph follows.'
    ];
    const items = text.map((str, index) => ({ str, height: 14.999999375, width: [210, 480, 480, 260, 220, 260][index],
      transform: [1, 0, 0, 1, 77, 703 - index * 24 + (index % 2 ? .000001 : 0) - (index === 5 ? 26 : 0)] }));
    const result = pdfParagraphs(items, 10);
    expect(result.map(item => item.text)).toEqual([text[0], text.slice(1, 5).join(' '), text[5]]);
    expect(result.every(item => item.page === 10)).toBe(true);
  });
  it('keeps large headings and columns separate', () => {
    const items = [
      { str: 'Chapter One', height: 24, width: 200, transform: [1, 0, 0, 1, 50, 700] },
      { str: 'A paragraph begins here and', height: 12, width: 220, transform: [1, 0, 0, 1, 50, 660] },
      { str: 'ends on this line.', height: 12, width: 160, transform: [1, 0, 0, 1, 50, 642] },
      { str: 'A separate column.', height: 12, width: 180, transform: [1, 0, 0, 1, 320, 660] }
    ];
    expect(pdfParagraphs(items, 1).map(item => item.text)).toEqual(['Chapter One', 'A paragraph begins here and ends on this line.', 'A separate column.']);
  });
  it('keeps bold or same-height subheadings separate from the paragraph they introduce', () => {
    const items = [
      { str: 'What price sensitivity means for your strategy', height: 12, width: 250, fontName: 'F2', transform: [1, 0, 0, 1, 72, 700] },
      { str: 'India contains different customer budgets and purchase priorities.', height: 12, width: 440, fontName: 'F1', transform: [1, 0, 0, 1, 72, 682] },
      { str: 'Each tier responds to a clear value proposition and transparent delivery.', height: 12, width: 430, fontName: 'F1', transform: [1, 0, 0, 1, 72, 664] }
    ];
    const result = pdfParagraphs(items, 2);
    expect(result).toEqual([
      { text: 'What price sensitivity means for your strategy', page: 2, heading: true },
      { text: 'India contains different customer budgets and purchase priorities. Each tier responds to a clear value proposition and transparent delivery.', page: 2, heading: false }
    ]);
  });
  it('separates subheadings after mixed-font paragraphs, longer headings, quotes, bullet lists, and page numbers', () => {
    const items = [
      { str: 'Evidence confidence:', height: 12, width: 110, fontName: 'Bold', transform: [1, 0, 0, 1, 72, 720] },
      { str: 'high that furniture is a real online category with steady demand.', height: 12, width: 330, fontName: 'Regular', transform: [1, 0, 0, 1, 186, 720] },
      { str: 'How to structure your online to showroom funnel for high-ticket custom orders', height: 12, width: 310, fontName: 'Bold', transform: [1, 0, 0, 1, 72, 700] },
      { str: '“India contains different customer budgets and purchase priorities across tiers.”', height: 12, width: 440, fontName: 'Regular', transform: [1, 0, 0, 1, 72, 682] },
      { str: '2. Check the money on three real orders', height: 12, width: 210, fontName: 'Bold', transform: [1, 0, 0, 1, 72, 668] },
      { str: 'For three recent completed orders, if available, write down the amount collected.', height: 12, width: 440, fontName: 'Regular', transform: [1, 0, 0, 1, 72, 650] },
      { str: '• Capture local intent early', height: 12, width: 180, fontName: 'Regular', transform: [1, 0, 0, 1, 72, 632] },
      { str: '• Offer design consultation', height: 12, width: 175, fontName: 'Regular', transform: [1, 0, 0, 1, 72, 614] },
      { str: '• Follow up with samples', height: 12, width: 165, fontName: 'Regular', transform: [1, 0, 0, 1, 72, 596] },
      { str: '42', height: 10, width: 16, fontName: 'Regular', transform: [1, 0, 0, 1, 300, 540] }
    ];
    const result = pdfParagraphs(items, 3);
    expect(result.map(item => [item.text, item.heading])).toEqual([
      ['Evidence confidence: high that furniture is a real online category with steady demand.', false],
      ['How to structure your online to showroom funnel for high-ticket custom orders', true],
      ['“India contains different customer budgets and purchase priorities across tiers.”', false],
      ['2. Check the money on three real orders', true],
      ['For three recent completed orders, if available, write down the amount collected.', false],
      ['• Capture local intent early', true],
      ['• Offer design consultation', true],
      ['• Follow up with samples', true],
      ['42', false]
    ]);
  });
  it('repairs old broken blocks and maps saved markers without crossing pages or headings', () => {
    const old = [{ text: 'Chapter One', page: 1, heading: true },
      { text: 'A sufficiently long sentence that the old importer split in the', page: 1 },
      { text: 'middle of the thought.', page: 1 },
      { text: 'A complete sentence.', page: 1 },
      { text: 'A continuation across a physical page', page: 1 },
      { text: 'ends here.', page: 2 }];
    const repaired = repairLegacyParagraphs(old);
    expect(repaired.segments[1].text).toBe(old[1].text + ' ' + old[2].text);
    expect(repaired.indexMap).toEqual([0, 1, 1, 2, 3, 4]);
    expect(old[1].text).not.toContain('middle');
    expect(repaired.segments.map(item => item.text).join(' ')).toBe(old.map(item => item.text).join(' '));
  });
});
