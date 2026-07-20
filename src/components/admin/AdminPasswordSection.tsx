'use client';

import { useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { KeyRound, Loader2, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import {
  clearAdminSession,
  createAdminSecret,
  type AdminSecret,
  unlockAdminSession,
  verifyAdminPassword,
} from '@/lib/admin-password';

class AdminSecretChangedError extends Error {}

function isSameAdminSecret(value: any, expected: AdminSecret): boolean {
  return value?.salt === expected.salt && value?.passwordHash === expected.passwordHash;
}

interface AdminPasswordSectionProps {
  db: Firestore;
  user: User;
  adminSecret: (AdminSecret & { id?: string }) | null;
  isLoading: boolean;
}

/**
 * Senha da Retaguarda: impede que quem está usando a máquina do caixa entre no
 * back-office. Guardada como hash+salt em admin_secrets/{uid} — nunca no perfil
 * público da loja. Extraída da antiga tela de Permissões do PDV.
 */
export function AdminPasswordSection({ db, user, adminSecret, isLoading }: AdminPasswordSectionProps) {
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const operationRef = useRef(false);

  const validateNewPassword = () => {
    if (newPassword.length < 4) {
      toast({ variant: 'destructive', title: 'Senha muito curta', description: 'Use pelo menos 4 números ou letras.' });
      return false;
    }
    if (newPassword !== confirmPassword) {
      toast({ variant: 'destructive', title: 'As senhas não são iguais' });
      return false;
    }
    return true;
  };

  const handleSave = async () => {
    if (operationRef.current || !validateNewPassword()) return;
    operationRef.current = true;
    setIsSaving(true);
    try {
      if (adminSecret && !(await verifyAdminPassword(currentPassword, adminSecret))) {
        toast({ variant: 'destructive', title: 'Senha atual incorreta' });
        return;
      }
      const secret = await createAdminSecret(newPassword);
      const secretRef = doc(db, 'admin_secrets', user.uid);
      await runTransaction(db, async (transaction) => {
        const latest = await transaction.get(secretRef);
        if (adminSecret) {
          if (!latest.exists() || !isSameAdminSecret(latest.data(), adminSecret)) {
            throw new AdminSecretChangedError('A senha foi alterada em outro lugar.');
          }
        } else if (latest.exists()) {
          throw new AdminSecretChangedError('Uma senha foi criada em outro lugar.');
        }
        transaction.set(secretRef, { ...secret, updatedAt: serverTimestamp() });
      });
      unlockAdminSession(user.uid, secret);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast({ title: adminSecret ? 'Senha alterada' : 'Senha criada', description: 'Guarde bem esta senha.' });
    } catch (error) {
      console.error('Erro ao salvar a senha da Retaguarda:', error);
      toast({
        variant: 'destructive',
        title: error instanceof AdminSecretChangedError ? 'Senha atualizada em outro lugar' : 'Não foi possível salvar a senha',
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      operationRef.current = false;
      setIsSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!adminSecret || operationRef.current) return;
    operationRef.current = true;
    setIsSaving(true);
    try {
      if (!(await verifyAdminPassword(currentPassword, adminSecret))) {
        toast({ variant: 'destructive', title: 'Senha atual incorreta' });
        return;
      }
      if (!window.confirm('Remover a senha da Retaguarda? Qualquer um na máquina volta a entrar direto.')) return;
      const secretRef = doc(db, 'admin_secrets', user.uid);
      await runTransaction(db, async (transaction) => {
        const latest = await transaction.get(secretRef);
        if (!latest.exists() || !isSameAdminSecret(latest.data(), adminSecret)) {
          throw new AdminSecretChangedError('A senha foi alterada em outro lugar.');
        }
        transaction.delete(secretRef);
      });
      clearAdminSession(user.uid);
      setCurrentPassword('');
      toast({ title: 'Senha removida' });
    } catch (error) {
      console.error('Erro ao remover a senha da Retaguarda:', error);
      toast({
        variant: 'destructive',
        title: error instanceof AdminSecretChangedError ? 'Senha atualizada em outro lugar' : 'Não foi possível remover a senha',
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      operationRef.current = false;
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <KeyRound className="h-4 w-4" />
          </span>
          Senha da Retaguarda
        </CardTitle>
        <CardDescription>
          Uma tranca a mais: com ela, quem estiver usando a máquina do caixa só entra aqui na Retaguarda (relatórios, produtos, configurações) digitando a senha. Fica liberada por 30 minutos depois que você digita.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="flex items-center text-sm text-slate-500"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verificando…</p>
        ) : (
          <>
            {!adminSecret && (
              <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>Ainda não há senha. Sem ela, qualquer um na máquina entra direto na Retaguarda.</span>
              </div>
            )}
            {adminSecret && (
              <div className="space-y-2">
                <Label htmlFor="current-admin-password">Senha atual</Label>
                <Input id="current-admin-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className="max-w-sm" />
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="new-admin-password">{adminSecret ? 'Nova senha' : 'Criar senha'}</Label>
                <Input id="new-admin-password" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-admin-password">Repetir a senha</Label>
                <Input id="confirm-admin-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
              </div>
            </div>
            <p className="text-xs text-amber-700">Guarde bem esta senha — não há recuperação automática. Se esquecer, o suporte precisa removê-la para você.</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={handleSave} disabled={isSaving || !newPassword || !confirmPassword || (!!adminSecret && !currentPassword)}>
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {adminSecret ? 'Alterar senha' : 'Definir senha'}
              </Button>
              {adminSecret && (
                <Button variant="outline" className="text-red-600 hover:bg-red-50 hover:text-red-700" onClick={handleRemove} disabled={isSaving || !currentPassword}>
                  Remover senha
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
