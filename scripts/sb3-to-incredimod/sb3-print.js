// Pretty-print Scratch 3 scripts: node sb3-print.js project.json "<target name>"
const p = require(require('path').resolve(process.argv[2]));
const t = p.targets.find((x) => x.name === process.argv[3]);
const B = t.blocks;
function input(b, name) {
  const i = b.inputs[name]; if (!i) return '';
  const v = i[1];
  if (Array.isArray(v)) return v[0] === 12 ? `(${v[1]})` : JSON.stringify(v[1]);
  if (typeof v === 'string') return expr(v);
  return '';
}
function expr(id) {
  const b = B[id]; if (!b) return '?';
  if (b.shadow && Object.keys(b.fields).length) return JSON.stringify(Object.values(b.fields)[0][0]);
  if (b.opcode === 'procedures_call' || b.opcode === 'procedures_prototype') { const m = b.mutation || {}; const ids = JSON.parse(m.argumentids || '[]'); return (b.opcode === 'procedures_call' ? 'CALL ' : 'DEF ') + JSON.stringify(m.proccode) + (ids.length ? ' [' + ids.map((a) => input(b, a)).join(', ') + ']' : ''); }
  if (b.opcode === 'procedures_definition') return expr(b.inputs.custom_block[1]);
  const args = Object.keys(b.inputs).filter((k) => !k.startsWith('SUBSTACK')).map((k) => `${k}=${input(b, k)}`);
  const fields = Object.entries(b.fields).map(([k, v]) => `${k}:${v[0]}`);
  return `${b.opcode}(${[...fields, ...args].join(', ')})`;
}
function stack(id, ind) {
  while (id) {
    const b = B[id];
    console.log(ind + expr(id));
    for (const k of ['SUBSTACK', 'SUBSTACK2']) if (b.inputs[k] && b.inputs[k][1]) { console.log(ind + (k === 'SUBSTACK2' ? 'else:' : '  {')); stack(b.inputs[k][1], ind + '    '); }
    id = b.next;
  }
}
for (const [id, b] of Object.entries(B)) if (b.topLevel && b.opcode) { console.log('---'); stack(id, ''); }
