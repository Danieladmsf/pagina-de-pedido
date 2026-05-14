const fs = require('fs');
let c = fs.readFileSync('src/components/MenuPageClient.tsx', 'utf8');

const target = `      <div className="relative z-20 max-w-7xl mx-auto px-3 pt-2 md:px-8 md:pt-3">
        <div className="rounded-2xl border border-primary/10 bg-white/95 p-2.5 shadow-xl shadow-slate-900/10 backdrop-blur-xl md:rounded-[1.75rem] md:p-4">
          <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(280px,420px)_minmax(0,1fr)] lg:items-center">
            <div className="relative min-w-0">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-primary/55 md:left-4 md:h-5 md:w-5" />
              <Input
                placeholder="O que você quer saborear hoje?"
                className="h-12 rounded-xl border-white/70 bg-white pl-10 text-sm shadow-md focus:ring-accent md:h-14 md:rounded-2xl md:pl-11 md:text-base"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="relative min-w-0 max-w-full group/cats">`;

const replacement = `      <div className="relative z-20 max-w-7xl mx-auto px-3 pt-2 md:px-8 md:pt-3">
        {/* Barra de Pesquisa Separada */}
        <div className="relative min-w-0 w-full mb-3 md:mb-5 lg:max-w-xl mx-auto">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary/50 md:h-5 md:w-5" />
          <Input
            placeholder="O que você quer saborear hoje?"
            className="h-14 w-full rounded-2xl border border-white/80 bg-white/90 shadow-md pl-12 text-sm backdrop-blur focus:bg-white focus:ring-accent md:h-16 md:rounded-[1.5rem] md:pl-12 md:text-base"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="rounded-2xl border border-primary/10 bg-white/95 p-2.5 shadow-xl shadow-slate-900/10 backdrop-blur-xl md:rounded-[1.75rem] md:p-4">
          <div className="relative min-w-0 max-w-full group/cats">`;

// Normaliza line endings para garantir match
c = c.replace(/\r\n/g, '\n');
const targetNorm = target.replace(/\r\n/g, '\n');

if (c.includes(targetNorm)) {
  c = c.replace(targetNorm, replacement);
  fs.writeFileSync('src/components/MenuPageClient.tsx', c);
  console.log("Success");
} else {
  console.log("Target not found");
}
