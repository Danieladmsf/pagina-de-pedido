const fs = require('fs');

const filePath = 'src/app/admin/page.tsx';
let content = fs.readFileSync(filePath, 'utf8');

content = content.replace(/VocíÂª/g, 'Você');
content = content.replace(/EstatíÂ­stico/g, 'Estatístico');
content = content.replace(/isponíÂ­veis/g, 'isponíveis');
content = content.replace(/TíÂ­tulo/g, 'Título');
content = content.replace(/víÂ­rgula/g, 'vírgula');
content = content.replace(/espaíÂ§os/g, 'espaços');
content = content.replace(/opíÂ§íÂµes/g, 'opções');
content = content.replace(/períÂ­odo/g, 'período');
content = content.replace(/concluíÂ­do/g, 'concluído');

fs.writeFileSync(filePath, content, 'utf8');
console.log('Fixed third pass of í-mangled encoding in page.tsx');
