const fs = require('node:fs');
const path = require('node:path');

const folder = path.join(__dirname, 'commands');

function scanFile(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const results = {
    file: path.relative(process.cwd(), filePath),
    interactionReply: [...src.matchAll(/interaction\.reply\s*\(/g)].length,
    interactionDefer: [...src.matchAll(/interaction\.deferReply\s*\(/g)].length,
    interactionEdit: [...src.matchAll(/interaction\.editReply\s*\(/g)].length,
    interactionFollow: [...src.matchAll(/interaction\.followUp\s*\(/g)].length,
    genericReply: [...src.matchAll(/(^|\W)reply\s*\(/g)].length, // may catch non-interaction replies
    lines: src.split(/\r?\n/),
  };
  // collect offending line numbers for quick inspection
  const offenders = [];
  ['interaction.reply','interaction.deferReply','interaction.editReply','interaction.followUp','reply('].forEach(term => {
    const re = new RegExp(term.replace('(', '\\(').replace('.', '\\.'), 'g');
    src.split(/\r?\n/).forEach((ln, i) => {
      if (re.test(ln)) offenders.push({ term, line: i+1, code: ln.trim() });
    });
  });
  results.offenders = offenders;
  return results;
}

function walk(dir) {
  const list = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) list.push(...walk(p));
    else if (name.endsWith('.js')) list.push(p);
  }
  return list;
}

function main() {
  if (!fs.existsSync(folder)) {
    console.error('Commands folder not found:', folder);
    process.exit(1);
  }
  const files = walk(folder);
  const summary = [];
  for (const f of files) {
    const r = scanFile(f);
    // heuristics: warn if multiple replies or defer+reply or replies after defer without editReply
    const warnings = [];
    if (r.interactionReply > 1) warnings.push(`interaction.reply used ${r.interactionReply} times`);
    if (r.interactionDefer > 0 && r.interactionReply > 0 && r.interactionEdit === 0) warnings.push(`deferReply used but no editReply (use editReply after deferring)`);
    if (r.interactionDefer > 0 && r.interactionReply > 1) warnings.push(`deferReply + multiple interaction.reply calls`);
    if (r.interactionReply > 0 && r.interactionEdit > 0 && r.interactionDefer === 0) warnings.push(`mixing reply and editReply without deferring`);
    if (warnings.length) {
      console.log('---');
      console.log('File:', r.file);
      warnings.forEach(w => console.log('WARNING:', w));
      console.log('Matches: reply=%d defer=%d edit=%d followUp=%d', r.interactionReply, r.interactionDefer, r.interactionEdit, r.interactionFollow);
      console.log('Offending lines (term : line : code):');
      r.offenders.slice(0, 30).forEach(o => console.log(` ${o.term} : ${o.line} : ${o.code}`));
      summary.push(r.file);
    }
  }
  if (summary.length === 0) {
    console.log('No obvious double-reply/defer issues found in commands folder.');
  } else {
    console.log('\nScanned files with potential issues:', summary.length);
  }
}

main();