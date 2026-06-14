'use client';

import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Download, Upload, Smartphone, Loader2 } from 'lucide-react';
import {
  downloadContactsCsvTemplate,
  parseContactsCsvFile,
  importContactsToClientes,
} from '@/lib/campanhas/contacts-import';

interface ImportContactsProps {
  db?: any;
  user?: any;
}

/**
 * Barra de importacao de contatos para Campanhas: modelo CSV, upload de CSV e
 * importacao direta dos contatos do WhatsApp da loja. Tudo cai na base
 * `clientes`, entao os importados aparecem na lista de contatos automaticamente.
 */
export function ImportContacts({ db, user }: ImportContactsProps) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [csvLoading, setCsvLoading] = useState(false);
  const [wapiLoading, setWapiLoading] = useState(false);

  const handleCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !db || !user) return;
    setCsvLoading(true);
    try {
      const contacts = await parseContactsCsvFile(file);
      if (contacts.length === 0) {
        toast({ variant: 'destructive', title: 'CSV vazio ou invalido', description: 'Use o modelo (nome, celular).' });
        return;
      }
      const { imported, skipped } = await importContactsToClientes(db, user.uid, contacts);
      toast({
        title: `${imported} contato(s) importado(s)`,
        description: skipped > 0 ? `${skipped} ignorado(s) (ja existiam ou sem telefone valido).` : 'Prontos para usar nas campanhas.',
      });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Erro na importacao', description: err?.message || 'Falha ao ler o CSV.' });
    } finally {
      setCsvLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleWhatsapp = async () => {
    if (!db || !user) return;
    setWapiLoading(true);
    try {
      // Força refresh do token: logo após restaurar a sessão, o token em cache
      // pode ainda ser de outra sessão (uid divergente) e causar 403.
      const token = await user.getIdToken(true);
      const res = await fetch(`/wapi/contacts/${user.uid}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) {
        throw new Error(data?.error || 'Nao foi possivel buscar os contatos do WhatsApp.');
      }
      const contacts = (data.contacts || []).map((c: any) => ({ nome: c.name || '', celular: c.phone || '' }));
      if (contacts.length === 0) {
        toast({ title: 'Nenhum contato encontrado', description: 'O WhatsApp da loja precisa estar conectado e ter conversas.' });
        return;
      }
      const { imported, skipped } = await importContactsToClientes(db, user.uid, contacts);
      toast({
        title: `${imported} contato(s) importado(s) do WhatsApp`,
        description: skipped > 0 ? `${skipped} ja estavam na base.` : 'Prontos para usar nas campanhas.',
      });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Erro ao importar do WhatsApp', description: err?.message || 'Verifique a conexao do WhatsApp.' });
    } finally {
      setWapiLoading(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input type="file" accept=".csv" ref={fileRef} onChange={handleCsv} className="hidden" />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={downloadContactsCsvTemplate}
        className="h-8 text-xs text-slate-600 hover:text-slate-900"
      >
        <Download className="h-3.5 w-3.5 mr-1.5" /> Modelo CSV
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => fileRef.current?.click()}
        disabled={csvLoading}
        className="h-8 text-xs"
      >
        {csvLoading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1.5" />}
        Importar CSV
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleWhatsapp}
        disabled={wapiLoading}
        className="h-8 text-xs border-emerald-300 text-emerald-700 hover:bg-emerald-50"
      >
        {wapiLoading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Smartphone className="h-3.5 w-3.5 mr-1.5" />}
        Importar do WhatsApp
      </Button>
    </div>
  );
}
