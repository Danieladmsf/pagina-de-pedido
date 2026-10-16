'use client';

import { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { KeyRound, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import {
  consultarSenhaDeCancelamento,
  definirSenhaDeCancelamento,
  removerSenhaDeCancelamento,
} from '@/lib/vendas/senha-cancelamento-client';

/**
 * Senha para cancelar vendas (só o dono vê). Mostra apenas "Senha definida" ou
 * "Sem senha": o servidor guarda só um código embaralhado e nunca devolve a senha.
 */
export function SenhaCancelamentoSection({ user }: { user: User }) {
  const { toast } = useToast();
  const [definida, setDefinida] = useState<boolean | null>(null);
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await consultarSenhaDeCancelamento(user);
      setDefinida(r.mensagem ? null : r.configured);
    } catch {
      setDefinida(null);
    }
  }, [user]);

  useEffect(() => { void carregar(); }, [carregar]);

  const salvar = async () => {
    setErro('');
    if (!/^\d{4,8}$/.test(senha)) {
      setErro('A senha deve ter de 4 a 8 números.');
      return;
    }
    setSalvando(true);
    try {
      const r = await definirSenhaDeCancelamento(user, senha);
      if (r.mensagem) {
        setErro(r.mensagem);
        return;
      }
      setDefinida(true);
      setSenha('');
      toast({ title: 'Senha de cancelamento salva' });
    } catch {
      setErro('Não foi possível salvar. Tente de novo.');
    } finally {
      setSalvando(false);
    }
  };

  const remover = async () => {
    setErro('');
    setSalvando(true);
    try {
      const r = await removerSenhaDeCancelamento(user);
      if (r.mensagem) {
        setErro(r.mensagem);
        return;
      }
      setDefinida(false);
      setSenha('');
      toast({ title: 'Senha de cancelamento removida' });
    } catch {
      setErro('Não foi possível remover. Tente de novo.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-emerald-600" /> Senha para cancelar vendas
          </CardTitle>
          <CardDescription>
            Com a senha definida, ninguém cancela uma venda sem digitá-la, nem você. Sem senha, o cancelamento segue livre como hoje.
          </CardDescription>
        </div>
        {definida !== null && (
          <Badge variant={definida ? 'default' : 'secondary'}>{definida ? 'Senha definida' : 'Sem senha'}</Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="space-y-2">
            <Label htmlFor="senha-cancelamento">{definida ? 'Nova senha (4 a 8 números)' : 'Senha (4 a 8 números)'}</Label>
            <Input
              id="senha-cancelamento"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={8}
              value={senha}
              onChange={(e) => { setSenha(e.target.value.replace(/\D/g, '')); setErro(''); }}
              className="w-48"
            />
          </div>
          <Button onClick={() => void salvar()} disabled={salvando || senha.length < 4}>
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : definida ? 'Trocar senha' : 'Definir senha'}
          </Button>
          {definida && (
            <Button variant="outline" onClick={() => void remover()} disabled={salvando}>Remover senha</Button>
          )}
        </div>
        {erro && <p className="text-sm text-rose-600">{erro}</p>}
      </CardContent>
    </Card>
  );
}
