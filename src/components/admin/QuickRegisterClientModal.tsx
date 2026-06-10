import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { collection, doc, setDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { UserPlus, Loader2 } from 'lucide-react';
import { normalizeCreditPhone } from '@/lib/customer-credit';

interface QuickRegisterClientModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  db: any;
  ownerId: string;
  initialName?: string;
  initialPhone?: string;
  initialAddress?: string; // used to prefill if possible
}

export function QuickRegisterClientModal({
  isOpen, onClose, onSuccess, db, ownerId, initialName = '', initialPhone = '', initialAddress = ''
}: QuickRegisterClientModalProps) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formNome, setFormNome] = useState('');
  const [formCelular, setFormCelular] = useState('');
  const [formNascimento, setFormNascimento] = useState('');
  const [formLogradouro, setFormLogradouro] = useState('');
  const [formNumero, setFormNumero] = useState('');
  const [formComplemento, setFormComplemento] = useState('');
  const [formBairro, setFormBairro] = useState('');
  const [formCidade, setFormCidade] = useState('');

  // Tenta preencher logradouro básico a partir do endereço do pedido de delivery se possível
  useEffect(() => {
    if (isOpen) {
      setFormNome(initialName || '');
      setFormCelular(initialPhone || '');
      setFormNascimento('');
      setFormNumero('');
      setFormComplemento('');
      setFormBairro('');
      setFormCidade('');
      
      if (initialAddress) {
        // Tentativa muito simples de separar: "Rua X, 123, Bairro, Cidade"
        const parts = initialAddress.split(',').map(p => p.trim());
        setFormLogradouro(parts[0] || initialAddress);
        if (parts[1]) setFormNumero(parts[1]);
        if (parts[2]) setFormBairro(parts[2]);
        if (parts[3]) setFormCidade(parts[3]);
      } else {
        setFormLogradouro('');
      }
    }
  }, [isOpen, initialName, initialPhone, initialAddress]);

  const handleMaskCelular = (val: string) => {
    const raw = val.replace(/\D/g, '');
    let masked = raw;
    if (raw.length > 2) masked = `(${raw.substring(0, 2)}) ` + raw.substring(2);
    if (raw.length > 7) masked = `(${raw.substring(0, 2)}) ${raw.substring(2, 7)}-${raw.substring(7, 11)}`;
    setFormCelular(masked);
  };

  const handleRegister = async () => {
    const phoneRaw = formCelular.replace(/\D/g, '');
    if (!formNome.trim()) {
      toast({ variant: 'destructive', title: 'Aviso', description: 'O Nome do Cliente é obrigatório.' });
      return;
    }
    if (phoneRaw.length < 10 || phoneRaw.length > 11) {
      toast({ variant: 'destructive', title: 'Aviso', description: 'Preencha o celular (WhatsApp) corretamente com DDD.' });
      return;
    }

    try {
      setIsSubmitting(true);
      const phoneNormalized = normalizeCreditPhone(phoneRaw);
      const docId = phoneNormalized ? `${ownerId}_${phoneNormalized}` : doc(collection(db, 'clientes')).id;
      const newRef = doc(db, 'clientes', docId);
      await setDoc(newRef, {
        id: docId,
        ownerId,
        nome: formNome,
        celular: phoneNormalized,
        dataNascimento: formNascimento,
        logradouro: formLogradouro,
        numero: formNumero,
        complemento: formComplemento,
        bairro: formBairro,
        cidade: formCidade,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        creditEnabled: true,
        creditLimit: 0,
        creditPayDay: 0,
        creditBalance: 0
      }, { merge: true });

      toast({ title: 'Sucesso', description: 'Cliente cadastrado com Prazo ativado!' });
      onSuccess(); // Close and let parent continue or re-trigger
    } catch (error) {
      console.error(error);
      toast({ variant: 'destructive', title: 'Erro', description: 'Erro ao cadastrar o cliente.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md bg-slate-50 border-slate-200">
        <DialogHeader>
          <div className="flex items-center gap-2 text-primary">
            <UserPlus className="h-5 w-5" />
            <DialogTitle className="text-xl">Cadastro Rápido (Prazo)</DialogTitle>
          </div>
          <DialogDescription className="text-slate-600">
            Cliente não encontrado. Complete os dados abaixo para registrar a dívida. O acesso ao Fiado já ficará liberado para ele.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2 max-h-[60vh] overflow-y-auto px-1 custom-scrollbar">
          <div className="grid gap-1">
            <Label className="text-xs font-semibold text-slate-700">Nome Completo <span className="text-red-500">*</span></Label>
            <Input value={formNome} onChange={e => setFormNome(e.target.value)} placeholder="Ex: João Silva" className="bg-white border-slate-300 focus-visible:ring-emerald-500" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label className="text-xs font-semibold text-slate-700">Celular / WhatsApp <span className="text-red-500">*</span></Label>
              <Input value={formCelular} onChange={e => handleMaskCelular(e.target.value)} placeholder="(00) 00000-0000" className="bg-white border-slate-300 focus-visible:ring-emerald-500" />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs font-semibold text-slate-700">Data de Nasc. (Opcional)</Label>
              <Input type="date" value={formNascimento} onChange={e => setFormNascimento(e.target.value)} className="bg-white border-slate-300 focus-visible:ring-emerald-500" />
            </div>
          </div>

          <div className="grid gap-1 pt-2">
            <Label className="text-xs font-semibold text-slate-700">Endereço de Entrega (Opcional)</Label>
            <div className="grid grid-cols-3 gap-2">
              <Input value={formLogradouro} onChange={e => setFormLogradouro(e.target.value)} placeholder="Rua / Avenida" className="col-span-2 bg-white border-slate-300 focus-visible:ring-emerald-500 text-sm" />
              <Input value={formNumero} onChange={e => setFormNumero(e.target.value)} placeholder="Nº" className="bg-white border-slate-300 focus-visible:ring-emerald-500 text-sm" />
            </div>
          </div>
          
          <div className="grid gap-1">
             <Input value={formComplemento} onChange={e => setFormComplemento(e.target.value)} placeholder="Complemento (Apto, Bloco...)" className="bg-white border-slate-300 focus-visible:ring-emerald-500 text-sm" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label className="text-xs font-semibold text-slate-700">Bairro</Label>
              <Input value={formBairro} onChange={e => setFormBairro(e.target.value)} placeholder="Bairro" className="bg-white border-slate-300 focus-visible:ring-emerald-500 text-sm" />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs font-semibold text-slate-700">Cidade</Label>
              <Input value={formCidade} onChange={e => setFormCidade(e.target.value)} placeholder="Cidade" className="bg-white border-slate-300 focus-visible:ring-emerald-500 text-sm" />
            </div>
          </div>

        </div>

        <DialogFooter className="mt-2 pt-2 border-t border-slate-200">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting} className="border-slate-300 text-slate-700">Cancelar</Button>
          <Button onClick={handleRegister} disabled={isSubmitting} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2">
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {isSubmitting ? 'Cadastrando...' : 'Cadastrar Cliente'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
