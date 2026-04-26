const fs = require('fs');

const filePath = 'src/app/admin/page.tsx';
let content = fs.readFileSync(filePath, 'utf8');

// The most mangled versions
content = content.replace(/AÃÂ§ÃÂµes/g, 'Ações');
content = content.replace(/PreÃÂ§o/g, 'Preço');
content = content.replace(/DisponÃÂveis/g, 'Disponíveis');
content = content.replace(/OpÃÂ§ÃÂµes/g, 'Opções');
content = content.replace(/BalcÃ£o/g, 'Balcão');
content = content.replace(/confirmaÃ§Ã£o/g, 'confirmação');

// Single mangled cases that might exist globally
content = content.replace(/Ã§Ã£/g, 'çã');
content = content.replace(/Ã§/g, 'ç');
content = content.replace(/Ã£o/g, 'ão');
content = content.replace(/Ã£/g, 'ã');
content = content.replace(/Ã¡/g, 'á');
content = content.replace(/Ã¢/g, 'â');
content = content.replace(/Ã©/g, 'é');
content = content.replace(/Ãª/g, 'ê');
content = content.replace(/Ã­/g, 'í');
content = content.replace(/Ã³/g, 'ó');
content = content.replace(/Ã´/g, 'ô');
content = content.replace(/Ãº/g, 'ú');
content = content.replace(/Ãµ/g, 'õ');
content = content.replace(/Ã§/g, 'ç');
content = content.replace(/Ã/g, 'í'); // Be careful with this global fallback, it could turn "AÃ" into "Aí" but Ã alone is usually í

// Fix double fixes if they happened (e.g., Açõesções -> Ações)
content = content.replace(/Açõess/g, 'Ações');
content = content.replace(/Preçoço/g, 'Preço');

fs.writeFileSync(filePath, content, 'utf8');
console.log('Fixed encoding in page.tsx');
