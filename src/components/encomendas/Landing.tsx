import type { EncomendaConfig } from '@/lib/encomendas/config';
import { Button } from '@/components/ui/button';
import {
  ArrowRight, CalendarClock, MapPin, HeartHandshake, Sparkles, Truck, ShieldCheck,
  AtSign, Quote, Check, Cake, CakeSlice, Cookie,
} from 'lucide-react';

const WHAT = [
  { icon: Cake, title: 'Bolos personalizados', desc: 'Do P ao XXG, com recheios em três níveis e acabamento à escolha.', tag: 'a partir de R$ 120' },
  { icon: CakeSlice, title: 'Tortas geladas', desc: 'Camadas cremosas e base crocante, nos tamanhos P, M e G.', tag: 'a partir de R$ 55' },
  { icon: Cookie, title: 'Docinhos finos', desc: 'Brigadeiros, beijinhos e gourmet sortido para a mesa de doces.', tag: 'mín. 50 un' },
];

const DEPO = [
  { ini: 'AB', name: 'Ana B.', ctx: 'Aniversário de 1 ano', text: 'O bolo ficou exatamente como sonhei. Massa fofinha e recheio na medida — todo mundo elogiou.' },
  { ini: 'CR', name: 'Carla R.', ctx: 'Chá de bebê', text: 'Os docinhos chegaram lindos e pontuais. Atendimento atencioso do começo ao fim.' },
  { ini: 'JM', name: 'João M.', ctx: 'Comemoração em família', text: 'A torta gelada foi a estrela do dia. Sabor delicado, nada enjoativo. Recomendo demais.' },
];

const SOBRE = [
  'Ingredientes selecionados e sempre frescos',
  'Massas feitas do zero, no dia',
  'Decoração delicada e personalizada',
  'Atendimento próximo, do orçamento à entrega',
];

export function Landing({ config, onStart }: { config: EncomendaConfig; onStart: () => void }) {
  const FEATURES = [
    { icon: HeartHandshake, title: 'Feito à mão', desc: 'Cada encomenda é montada com calma, camada por camada.' },
    { icon: Sparkles, title: 'Sabores autorais', desc: 'Recheios clássicos aos de assinatura, criados na casa.' },
    { icon: CalendarClock, title: 'Agenda cuidada', desc: `Reserve com no mínimo ${config.minDays} dias para garantir sua data.` },
    { icon: Truck, title: 'Entrega com zelo', desc: 'Seu pedido chega inteiro, fresco e na hora combinada.' },
  ];

  const Logo = () =>
    config.logoUrl ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={config.logoUrl} alt={config.name} className="h-full w-full rounded-full object-cover" />
    ) : (
      <span>{config.logoEmoji}</span>
    );

  return (
    <div>
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-lg ring-1 ring-primary/15"><Logo /></span>
            <div className="leading-none">
              <p className="font-display text-base font-bold text-foreground">{config.name}</p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Confeitaria artesanal</p>
            </div>
          </div>
          <Button onClick={onStart} className="rounded-full px-5 shadow-soft">Fazer pedido</Button>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-16 sm:py-24 md:grid-cols-2">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-primary">
              <Sparkles className="h-3.5 w-3.5" /> Encomendas online
            </span>
            <h1 className="mt-5 font-display text-4xl font-bold leading-[1.05] text-foreground sm:text-6xl">
              Doces que <span className="italic text-primary">emocionam</span> em cada fatia.
            </h1>
            <p className="mt-5 max-w-md text-base text-muted-foreground">
              Bolos, tortas e docinhos artesanais, montados sob encomenda e entregues na data que você escolher. Tudo em um único pedido.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button onClick={onStart} size="lg" className="rounded-full px-7 shadow-soft">
                Montar meu pedido <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
              <button onClick={onStart} className="text-sm font-semibold text-foreground/70 underline-offset-4 hover:underline">Ver sabores</button>
            </div>
            <div className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-xs font-medium text-muted-foreground">
              <span className="flex items-center gap-1.5"><CalendarClock className="h-4 w-4 text-primary" /> Mín. {config.minDays} dias de antecedência</span>
              {config.city && <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4 text-primary" /> Entrega em {config.city}</span>}
            </div>
          </div>
          {/* Cartão decorativo */}
          <div className="relative hidden md:block">
            <div className="absolute -right-6 -top-6 h-40 w-40 rounded-full bg-accent/15 blur-2xl" />
            <div className="absolute -bottom-8 -left-8 h-48 w-48 rounded-full bg-primary/10 blur-2xl" />
            <div className="relative grid grid-cols-2 gap-3">
              <div className="flex aspect-square items-center justify-center rounded-3xl bg-card text-6xl shadow-card">🎂</div>
              <div className="mt-8 flex aspect-square items-center justify-center rounded-3xl bg-card text-6xl shadow-card">🍓</div>
              <div className="flex aspect-square items-center justify-center rounded-3xl bg-card text-6xl shadow-card">🧁</div>
              <div className="mt-8 flex aspect-square items-center justify-center rounded-3xl bg-card text-6xl shadow-card">🍰</div>
            </div>
          </div>
        </div>
      </section>

      {/* Diferenciais */}
      <section className="border-y border-border/60 bg-card/50">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px overflow-hidden px-4 py-2 md:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="flex flex-col items-center gap-2 px-3 py-7 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary"><f.icon className="h-5 w-5" /></span>
              <p className="font-display text-sm font-bold text-foreground">{f.title}</p>
              <p className="text-xs leading-snug text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* O que fazemos */}
      <section className="mx-auto max-w-6xl px-4 py-20">
        <Kicker>O que fazemos</Kicker>
        <h2 className="mx-auto mt-2 max-w-2xl text-center font-display text-3xl font-bold text-foreground sm:text-4xl">
          Uma mesa de doces inteira, em um só pedido.
        </h2>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {WHAT.map((c) => (
            <div key={c.title} className="group rounded-3xl border border-border bg-card p-6 shadow-card transition hover:-translate-y-1 hover:shadow-soft">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-accent/15 text-primary"><c.icon className="h-6 w-6" /></span>
              <h3 className="mt-4 font-display text-xl font-bold text-foreground">{c.title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{c.desc}</p>
              <span className="mt-4 inline-block rounded-full bg-accent/15 px-3 py-1 text-xs font-bold text-gold">{c.tag}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Depoimentos */}
      <section className="border-y border-border/60 bg-secondary/30">
        <div className="mx-auto max-w-6xl px-4 py-20">
          <Kicker>Depoimentos</Kicker>
          <h2 className="mt-2 text-center font-display text-3xl font-bold text-foreground sm:text-4xl">Quem prova, volta sempre.</h2>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {DEPO.map((d) => (
              <figure key={d.name} className="rounded-3xl border border-border bg-card p-6 shadow-card">
                <Quote className="h-7 w-7 text-primary/25" />
                <blockquote className="mt-3 text-sm leading-relaxed text-foreground/90">“{d.text}”</blockquote>
                <figcaption className="mt-5 flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{d.ini}</span>
                  <span>
                    <span className="block text-sm font-bold text-foreground">{d.name}</span>
                    <span className="block text-xs text-muted-foreground">{d.ctx}</span>
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* Sobre */}
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-20 md:grid-cols-2">
        <div className="order-2 grid grid-cols-2 gap-3 md:order-1">
          <div className="flex aspect-[4/5] items-center justify-center rounded-3xl bg-card text-6xl shadow-card">👩‍🍳</div>
          <div className="mt-10 flex aspect-[4/5] items-center justify-center rounded-3xl bg-card text-6xl shadow-card">🍒</div>
        </div>
        <div className="order-1 md:order-2">
          <Kicker className="text-left">Sobre nós</Kicker>
          <h2 className="mt-2 font-display text-3xl font-bold text-foreground sm:text-4xl">Da nossa cozinha para o seu momento.</h2>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Nascemos do amor por receitas de família e do prazer de criar momentos doces. Cada bolo é único, feito com massas leves, recheios cremosos e um cuidado que se sente em cada fatia.
          </p>
          <ul className="mt-6 space-y-2.5">
            {SOBRE.map((s) => (
              <li key={s} className="flex items-center gap-2.5 text-sm text-foreground/90">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-primary"><Check className="h-3 w-3" /></span>{s}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 pb-20">
        <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-primary to-[#9d164c] px-6 py-12 text-center text-white shadow-soft sm:px-12">
          <ShieldCheck className="mx-auto h-8 w-8 text-white/80" />
          <h2 className="mt-3 font-display text-3xl font-bold sm:text-4xl">Pronto para encomendar?</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-white/80">
            Monte seu pedido em poucos passos. Pagamento por PIX com {config.sinalPercent}% de entrada e confirmação no WhatsApp.
          </p>
          <Button onClick={onStart} size="lg" className="mt-6 rounded-full bg-white px-8 text-primary hover:bg-white/90">
            Começar pedido <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/60 bg-card/50">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-3">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-lg"><Logo /></span>
              <p className="font-display text-base font-bold text-foreground">{config.name}</p>
            </div>
            <p className="mt-3 max-w-xs text-xs leading-relaxed text-muted-foreground">{config.tagline}</p>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-gold">Contato</p>
            <ul className="mt-3 space-y-1.5 text-sm text-foreground/80">
              {config.whatsapp && <li>{config.whatsapp}</li>}
              {config.instagram && <li className="flex items-center gap-1.5"><AtSign className="h-3.5 w-3.5" /> {config.instagram}</li>}
              {config.city && <li className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> {config.city} e região</li>}
            </ul>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-gold">Horário</p>
            <ul className="mt-3 space-y-1.5 text-sm text-foreground/80">
              <li>{config.daysLabel}</li>
              <li>{config.hours}</li>
            </ul>
            <button onClick={onStart} className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-primary hover:underline">
              Fazer encomenda online <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="border-t border-border/60 py-4 text-center text-[11px] text-muted-foreground">
          © {new Date().getFullYear()} {config.name}
        </div>
      </footer>
    </div>
  );
}

function Kicker({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-center text-[11px] font-bold uppercase tracking-[0.2em] text-gold ${className}`}>{children}</p>;
}
