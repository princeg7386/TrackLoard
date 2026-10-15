const ts = require('typescript');
const fs = require('fs'), path = require('path');
const root = process.argv[2]; const out = [];
function walk(d){ for (const f of fs.readdirSync(d)) { const p=path.join(d,f); if (fs.statSync(p).isDirectory()) walk(p); else if (p.endsWith('.ts')) scan(p);} }
function scan(p){
  const sf = ts.createSourceFile(p, fs.readFileSync(p,'utf8'), ts.ScriptTarget.Latest, true);
  const visit = n => {
    let t=null, dyn=false;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) t=n.text;
    else if (ts.isTemplateExpression(n)) { dyn=true; t=n.head.text; for (const sp of n.templateSpans){ t+=' ${'+sp.expression.getText(sf)+'} '+sp.literal.text;} }
    if (t && /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\s/i.test(t) && /\b(FROM|INTO|SET|SELECT)\b/i.test(t)) {
      const {line} = sf.getLineAndCharacterOfPosition(n.getStart());
      out.push({file: path.relative(root,p), line: line+1, sql: t, dynamic: dyn});
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
walk(root);
fs.writeFileSync(process.argv[3], JSON.stringify(out,null,1));
console.log(out.length, 'queries;', out.filter(o=>o.dynamic).length, 'dynamic');
