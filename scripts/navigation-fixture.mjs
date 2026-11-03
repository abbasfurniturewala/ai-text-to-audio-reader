export function navigationPdf({ outline = true, novel = false, count = 50 } = {}) {
  const objects = ['', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'], pages = [];
  const escape = text => text.replace(/[\\()]/g, '\\$&');
  for (let page = 1; page <= count; page++) {
    const id = objects.length + 1;
    pages.push(id);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 1200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`);
    const text = (value, y, size = 12) => `BT /F1 ${size} Tf 48 ${y} Td (${escape(value)}) Tj ET`;
    let stream = '';
    if (outline && page === 2) stream += text('Chapter 1', 1130, 24);
    if (outline && page === 3) stream += text('1.1 Demand', 1130, 20) + text('1.2 Supply', 650, 20);
    if (outline && page === 5) stream += text('Chapter 2 Budget Constraint', 1130, 24);
    if (novel && [2, 4].includes(page)) stream += text(page === 2 ? 'Chapter One' : 'Chapter II', 1130, 24);
    for (let line = 0; line < 12; line++) stream += text(`On page ${page} passage ${line + 1} we follow a complete story through the trees.`, 1060 - line * 80);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  let outlineRoot = '';
  if (outline) {
    const id = objects.length + 1;
    outlineRoot = `/Outlines ${id} 0 R`;
    objects.push(`<< /Type /Outlines /First ${id + 1} 0 R /Last ${id + 2} 0 R /Count 4 >>`);
    objects.push(`<< /Title (Chapter 1) /Parent ${id} 0 R /Dest [${pages[1]} 0 R /XYZ null 1130 null] /Next ${id + 2} 0 R /First ${id + 3} 0 R /Last ${id + 4} 0 R /Count 2 >>`);
    objects.push(`<< /Title (Chapter 2 Budget Constraint) /Parent ${id} 0 R /Dest [${pages[4]} 0 R /XYZ null 1130 null] /Prev ${id + 1} 0 R >>`);
    objects.push(`<< /Title (1.1 Demand) /Parent ${id + 1} 0 R /Dest [${pages[2]} 0 R /XYZ null 1130 null] /Next ${id + 4} 0 R >>`);
    objects.push(`<< /Title (1.2 Supply) /Parent ${id + 1} 0 R /Dest [${pages[2]} 0 R /XYZ null 650 null] /Prev ${id + 3} 0 R >>`);
  }
  objects[0] = `<< /Type /Catalog /Pages 2 0 R ${outlineRoot} >>`;
  objects[1] = `<< /Type /Pages /Kids [${pages.map(id => `${id} 0 R`).join(' ')}] /Count ${count} >>`;
  let body = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  return body + `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
}
