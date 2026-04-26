const fs = require('fs');

const filePath = 'src/app/admin/page.tsx';
let content = fs.readFileSync(filePath, 'utf8');

// Fix the mangled versions resulting from Ã -> í
content = content.replace(/AíÂ§íÂµes/g, 'Ações');
content = content.replace(/PreíÂ§o/g, 'Preço');
content = content.replace(/DisponíÂveis/g, 'Disponíveis');
content = content.replace(/OpíÂ§íÂµes/g, 'Opções');
content = content.replace(/Balcí£o/g, 'Balcão');
content = content.replace(/confirmaí§í£o/g, 'confirmação');
content = content.replace(/importaí§í£o/g, 'importação');
content = content.replace(/Importaí§í£o/g, 'Importação');
content = content.replace(/Atení§í£o/g, 'Atenção');
content = content.replace(/atení§í£o/g, 'atenção');
content = content.replace(/Atualizaí§í£o/g, 'Atualização');
content = content.replace(/atualizaí§í£o/g, 'atualização');
content = content.replace(/Criarí¡/g, 'Criará');
content = content.replace(/criarí¡/g, 'criará');

// One more pass for anything that didn't have Â
content = content.replace(/Aí§íµes/g, 'Ações');
content = content.replace(/Preí§o/g, 'Preço');
content = content.replace(/Opí§íµes/g, 'Opções');
content = content.replace(/Balcí£o/g, 'Balcão');

fs.writeFileSync(filePath, content, 'utf8');
console.log('Fixed í-mangled encoding in page.tsx');
