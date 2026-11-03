export function fivePagePdf({ blankPage, labels = false, outline = false } = {}) {
  const objects = ['', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const pages = [];
  for (let page = 1; page <= 5; page++) {
    const id = objects.length + 1;
    pages.push(`${id} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`);
    const stream = blankPage === page ? '' : 'BT /F1 12 Tf 48 735 Td ' + Array.from({ length: 8 }, (_, i) => `${i ? '0 -64 Td ' : ''}(On page ${page} passage ${i + 1} we follow a calm story through the trees.) Tj`).join(' ') + ' ET';
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  let outlineRoot = '';
  if (outline) {
    const id = objects.length + 1;
    outlineRoot = `/Outlines ${id} 0 R`;
    objects.push(`<< /Type /Outlines /First ${id + 1} 0 R /Last ${id + 2} 0 R /Count 4 >>`);
    objects.push(`<< /Title (Chapter 1 The Market) /Parent ${id} 0 R /Dest [6 0 R /Fit] /Next ${id + 2} 0 R /First ${id + 3} 0 R /Last ${id + 4} 0 R /Count 2 >>`);
    objects.push(`<< /Title (Chapter 2 Budget Constraint) /Parent ${id} 0 R /Dest [10 0 R /Fit] /Prev ${id + 1} 0 R >>`);
    objects.push(`<< /Title (1.1 Demand) /Parent ${id + 1} 0 R /Dest [8 0 R /Fit] /Next ${id + 4} 0 R >>`);
    objects.push(`<< /Title (1.2 Supply) /Parent ${id + 1} 0 R /Dest [8 0 R /Fit] /Prev ${id + 3} 0 R >>`);
  }
  objects[0] = `<< /Type /Catalog /Pages 2 0 R ${outlineRoot} ${labels ? '/PageLabels << /Nums [0 << /S /r >> 2 << /S /D /St 1 >>] >>' : ''} >>`;
  objects[1] = `<< /Type /Pages /Kids [${pages.join(' ')}] /Count 5 >>`;
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  return body + `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
}
