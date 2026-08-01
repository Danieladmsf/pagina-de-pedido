'use client';

import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Download, Upload, Loader2 } from 'lucide-react';
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
 * Barra de importacao de contatos para Campanhas via CSV: baixa um modelo e
 * importa um arquivo (nome,celular). Os contatos caem na base `clientes`, entao
 * aparecem na lista de contatos automaticamente.
 */
export function ImportContacts({ db, user }: ImportContactsProps) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [csvLoading, setCsvLoading] = useState(false);

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
    </div>
  );
}
