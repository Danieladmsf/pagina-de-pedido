'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { Bike, Loader2, Plus, Trash2, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { CurrencyInput } from '@/components/ui/currency-input';
import { useFirestore, useUser } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { brl } from '@/lib/utils';

/**
 * Cadastro da equipe de entrega (motoboys e diaristas).
 *
 * Vive aqui, e só aqui: era uma página separada em Perfil da Loja, e o perfil
 * regravava `motoboys`/`freelancers` a cada salvamento de QUALQUER seção — com
 * duas telas donas do mesmo dado, salvar "Dados e Contato" apagaria uma pessoa
 * cadastrada na outra aba. Este editor grava só os dois campos, com merge.
 */

export type MotoboyCadastro = { id: string; name: string; phone: string; licensePlate: string; fee: number };
export type DiaristaCadastro = { id: string; name: string; whatsapp: string; dailyRate: number; workDays: string[]; active: boolean };

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'] as const;
const DIAS_UTEIS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'];

const novoId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const formatarTelefone = (valor: string) => {
  const d = (valor || '').replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};

const iniciais = (nome: string) =>
  (nome || '?')
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

const lerMotoboys = (perfil: any): MotoboyCadastro[] =>
  ((perfil?.motoboys as any[]) || []).map((m) => ({
    id: String(m.id ?? novoId()),
    name: m.name || '',
    phone: m.phone || '',
    licensePlate: m.licensePlate || '',
    fee: Number(m.fee) || 0,
  }));

const lerDiaristas = (perfil: any): DiaristaCadastro[] =>
  ((perfil?.freelancers as any[]) || []).map((f) => ({
    id: String(f.id ?? novoId()),
    name: f.name || '',
    whatsapp: f.whatsapp || '',
    dailyRate: Number(f.dailyRate) || 0,
    workDays: f.workDays || [...DIAS],
    active: f.active !== false,
  }));

export function EquipeEntregas({ storeProfile }: { storeProfile: any }) {
  const db = useFirestore();
  const { user } = useUser();
  const { toast } = useToast();

  const salvos = useMemo(
    () => ({ motoboys: lerMotoboys(storeProfile), diaristas: lerDiaristas(storeProfile) }),
    [storeProfile],
  );

  const [motoboys, setMotoboys] = useState<MotoboyCadastro[]>(salvos.motoboys);
  const [diaristas, setDiaristas] = useState<DiaristaCadastro[]>(salvos.diaristas);
  const [salvando, setSalvando] = useState(false);

  // O perfil chega em tempo real. Só re-sincroniza quando não há rascunho, para
  // não apagar o que está sendo digitado quando outra tela mexe no perfil.
  const sujo = useMemo(
    () => JSON.stringify({ motoboys, diaristas }) !== JSON.stringify(salvos),
    [motoboys, diaristas, salvos],
  );
  const sujoRef = React.useRef(sujo);
  sujoRef.current = sujo;

  useEffect(() => {
    if (sujoRef.current) return;
    setMotoboys(salvos.motoboys);
    setDiaristas(salvos.diaristas);
  }, [salvos]);

  const salvar = async () => {
    if (!db || !user?.uid) return;
    const semNome = [...motoboys, ...diaristas].some((p) => !p.name.trim());
    if (semNome) {
      toast({ variant: 'destructive', title: 'Falta o nome', description: 'Todo mundo na lista precisa de um nome antes de salvar.' });
      return;
    }
    setSalvando(true);
    try {
      const motoboysLimpos = motoboys.map((m) => ({ ...m, name: m.name.trim(), fee: Number(m.fee) || 0 }));
      const diaristasLimpos = diaristas.map((f) => ({ ...f, name: f.name.trim(), dailyRate: Number(f.dailyRate) || 0 }));
      await setDoc(
        doc(db, 'store_profiles', user.uid),
        { motoboys: motoboysLimpos, freelancers: diaristasLimpos },
        { merge: true },
      );
      // O rascunho passa a ser o que foi gravado: sem isso, um nome digitado
      // com espaço no fim deixaria a barra de "alterações não salvas" para
      // sempre na tela, porque o trim só acontece na gravação.
      setMotoboys(motoboysLimpos);
      setDiaristas(diaristasLimpos);
      toast({ title: 'Equipe salva!' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Erro ao salvar', description: err.message });
    } finally {
      setSalvando(false);
    }
  };

  const descartar = () => {
    setMotoboys(salvos.motoboys);
    setDiaristas(salvos.diaristas);
  };

  const mudarMotoboy = (id: string, campo: keyof MotoboyCadastro, valor: any) =>
    setMotoboys((prev) => prev.map((m) => (m.id === id ? { ...m, [campo]: valor } : m)));

  const mudarDiarista = (id: string, campo: keyof DiaristaCadastro, valor: any) =>
    setDiaristas((prev) => prev.map((f) => (f.id === id ? { ...f, [campo]: valor } : f)));

  const alternarDia = (id: string, dia: string) =>
    setDiaristas((prev) =>
      prev.map((f) =>
        f.id === id
          ? { ...f, workDays: f.workDays.includes(dia) ? f.workDays.filter((d) => d !== dia) : [...f.workDays, dia] }
          : f,
      ),
    );

  return (
    <div className="space-y-5 pb-28">
      {/* ───────────── Motoboys ───────────── */}
      <section className="bg-white rounded-2xl border shadow-sm overflow-hidden">
        <header className="px-5 py-4 border-b bg-gradient-to-r from-blue-50/60 to-white flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
            <Bike className="h-5 w-5 text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold text-slate-800">Frota própria</h3>
            <p className="text-xs text-muted-foreground">Motoboys fixos, com taxa por dia trabalhado.</p>
          </div>
          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-[10px] shrink-0">
            {motoboys.length} {motoboys.length === 1 ? 'motoboy' : 'motoboys'}
          </Badge>
          <Button
            onClick={() => setMotoboys((p) => [...p, { id: novoId(), name: '', phone: '', licensePlate: '', fee: 0 }])}
            className="gap-1.5 h-8 text-xs bg-blue-600 hover:bg-blue-700 shrink-0"
          >
            <Plus className="w-3.5 h-3.5" /> Adicionar
          </Button>
        </header>

        <div className="p-4 space-y-3">
          {motoboys.length === 0 ? (
            <p className="rounded-xl border-2 border-dashed py-8 text-center text-sm text-slate-400">
              Nenhum motoboy na frota. Clique em "Adicionar".
            </p>
          ) : (
            motoboys.map((m) => (
              <div key={m.id} className="rounded-xl border bg-slate-50/50 p-3 transition-colors hover:border-blue-200">
                <div className="flex items-start gap-3">
                  <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-black text-blue-700">
                    {iniciais(m.name)}
                  </div>
                  <div className="grid flex-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="space-y-1">
                      <Label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Nome</Label>
                      <Input value={m.name} onChange={(e) => mudarMotoboy(m.id, 'name', e.target.value)} placeholder="João" className="h-8 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">WhatsApp</Label>
                      <Input value={m.phone} onChange={(e) => mudarMotoboy(m.id, 'phone', formatarTelefone(e.target.value))} placeholder="(00) 90000-0000" className="h-8 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Placa</Label>
                      <Input value={m.licensePlate} onChange={(e) => mudarMotoboy(m.id, 'licensePlate', e.target.value.toUpperCase())} placeholder="ABC-1234" maxLength={8} className="h-8 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Taxa por dia</Label>
                      <CurrencyInput value={m.fee} onChange={(val) => mudarMotoboy(m.id, 'fee', val)} />
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() => setMotoboys((p) => p.filter((x) => x.id !== m.id))}
                    className="mt-5 h-8 w-8 shrink-0 p-0 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    title="Remover da frota"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* ───────────── Diaristas ───────────── */}
      <section className="bg-white rounded-2xl border shadow-sm overflow-hidden">
        <header className="px-5 py-4 border-b bg-gradient-to-r from-purple-50/60 to-white flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0">
            <Users className="h-5 w-5 text-purple-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold text-slate-800">Freelancers diaristas</h3>
            <p className="text-xs text-muted-foreground">Diária fixa e escala da semana. Quem está escalado no dia aparece no caixa.</p>
          </div>
          <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200 text-[10px] shrink-0">
            {diaristas.filter((f) => f.active).length} {diaristas.filter((f) => f.active).length === 1 ? 'ativo' : 'ativos'}
          </Badge>
          <Button
            onClick={() =>
              setDiaristas((p) => [...p, { id: novoId(), name: '', whatsapp: '', dailyRate: 0, workDays: [...DIAS], active: true }])
            }
            className="gap-1.5 h-8 text-xs bg-purple-600 hover:bg-purple-700 shrink-0"
          >
            <Plus className="w-3.5 h-3.5" /> Adicionar
          </Button>
        </header>

        <div className="p-4 space-y-3">
          {diaristas.length === 0 ? (
            <p className="rounded-xl border-2 border-dashed py-8 text-center text-sm text-slate-400">
              Nenhum diarista cadastrado. Clique em "Adicionar".
            </p>
          ) : (
            diaristas.map((f) => (
              <div
                key={f.id}
                className={`rounded-xl border p-3 transition-colors ${f.active ? 'bg-slate-50/50 hover:border-purple-200' : 'bg-slate-100/60 opacity-75'}`}
              >
                <div className="flex items-start gap-3">
                  <div className={`mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-black ${f.active ? 'bg-purple-100 text-purple-700' : 'bg-slate-200 text-slate-500'}`}>
                    {iniciais(f.name)}
                  </div>
                  <div className="flex-1 space-y-2.5">
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      <div className="space-y-1">
                        <Label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Nome</Label>
                        <Input value={f.name} onChange={(e) => mudarDiarista(f.id, 'name', e.target.value)} placeholder="Pedro" className="h-8 text-sm" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">WhatsApp</Label>
                        <Input value={f.whatsapp} onChange={(e) => mudarDiarista(f.id, 'whatsapp', formatarTelefone(e.target.value))} placeholder="(00) 90000-0000" className="h-8 text-sm" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Diária</Label>
                        <CurrencyInput value={f.dailyRate} onChange={(val) => mudarDiarista(f.id, 'dailyRate', val)} />
                      </div>
                      <div className="flex items-end pb-1">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={f.active}
                            onCheckedChange={(checked) => mudarDiarista(f.id, 'active', checked)}
                            className="scale-90 data-[state=checked]:bg-emerald-500"
                          />
                          <span className={`text-xs font-bold ${f.active ? 'text-emerald-600' : 'text-slate-400'}`}>
                            {f.active ? 'Ativo' : 'Inativo'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-200/70 pt-2">
                      <span className="mr-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">Escala</span>
                      {DIAS.map((dia) => {
                        const marcado = f.workDays?.includes(dia);
                        return (
                          <button
                            key={dia}
                            type="button"
                            onClick={() => alternarDia(f.id, dia)}
                            className={`rounded-lg border px-2 py-1 text-[11px] font-bold transition-colors ${
                              marcado
                                ? 'border-purple-300 bg-purple-100 text-purple-700'
                                : 'border-slate-200 bg-white text-slate-400 hover:bg-slate-100'
                            }`}
                          >
                            {dia}
                          </button>
                        );
                      })}
                      <span className="mx-1 text-slate-200">|</span>
                      <button type="button" onClick={() => mudarDiarista(f.id, 'workDays', [...DIAS])} className="text-[11px] font-bold text-slate-400 hover:text-purple-600">
                        Todos
                      </button>
                      <button type="button" onClick={() => mudarDiarista(f.id, 'workDays', DIAS_UTEIS)} className="text-[11px] font-bold text-slate-400 hover:text-purple-600">
                        Seg a Sex
                      </button>
                      {f.dailyRate > 0 && f.workDays.length > 0 && (
                        <span className="ml-auto text-[11px] text-slate-400">
                          {f.workDays.length}x/semana · até <strong className="text-slate-600">{brl(f.dailyRate * f.workDays.length)}</strong>/semana
                        </span>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() => setDiaristas((p) => p.filter((x) => x.id !== f.id))}
                    className="mt-5 h-8 w-8 shrink-0 p-0 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    title="Remover do cadastro"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Barra de salvar: só aparece quando há mudança, para a tela não viver
          pedindo "salvar" sem motivo. */}
      {sujo && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-white/95 px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur">
          <div className="mx-auto flex max-w-4xl items-center gap-3">
            <span className="flex-1 text-sm font-medium text-slate-600">Você tem alterações não salvas na equipe.</span>
            <Button variant="ghost" onClick={descartar} disabled={salvando} className="text-slate-500">
              Descartar
            </Button>
            <Button onClick={salvar} disabled={salvando} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
              {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Salvar equipe
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
