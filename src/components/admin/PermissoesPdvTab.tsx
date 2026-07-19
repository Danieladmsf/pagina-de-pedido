'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { doc, runTransaction, serverTimestamp, updateDoc } from 'firebase/firestore';
import { KeyRound, Loader2, RotateCcw, Save, ShieldCheck, TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import {
  clearAdminSession,
  createAdminSecret,
  type AdminSecret,
  unlockAdminSession,
  verifyAdminPassword,
} from '@/lib/admin-password';
import {
  getEligibleTabs,
  getPdvPermissions,
  PDV_PERMISSION_PATHS,
  type PdvPermissionPath,
  type PdvPermissions,
  type PdvTabId,
} from '@/lib/pdv-permissions';

interface PermissoesPdvTabProps {
  db: Firestore;
  user: User;
  storeProfile: any;
  isProfileLoading: boolean;
  adminSecret: (AdminSecret & { id?: string }) | null;
  isAdminSecretLoading: boolean;
}

interface ActionOption {
  path: PdvPermissionPath;
  label: string;
  description?: string;
}

interface TabOption {
  id: PdvTabId;
  label: string;
  description: string;
  actions: ActionOption[];
}

const TAB_OPTIONS: TabOption[] = [
  {
    id: 'caixa',
    label: 'Caixa',
    description: 'Abertura, fechamento e movimentações financeiras.',
    actions: [
      { path: 'actions.caixa.abrirCaixa', label: 'Abrir caixa' },
      { path: 'actions.caixa.fecharCaixa', label: 'Fechar caixa' },
      { path: 'actions.caixa.suprimento', label: 'Fazer suprimento manual' },
      { path: 'actions.caixa.sangria', label: 'Fazer sangria manual' },
      { path: 'actions.caixa.cancelarVenda', label: 'Cancelar ou reativar venda' },
      { path: 'actions.caixa.verCaixasAnteriores', label: 'Ver caixas anteriores' },
    ],
  },
  {
    id: 'delivery',
    label: 'Delivery',
    description: 'Pedidos recebidos para entrega e retirada.',
    actions: [
      { path: 'actions.delivery.finalizarPedido', label: 'Finalizar pedido e pagamento' },
      { path: 'actions.delivery.mudarStatus', label: 'Mudar status e motoboy' },
      { path: 'actions.delivery.editarItens', label: 'Adicionar ou remover itens' },
      { path: 'actions.delivery.cancelarPedido', label: 'Cancelar pedido' },
      { path: 'actions.delivery.descontoAcrescimo', label: 'Aplicar desconto ou acréscimo' },
      { path: 'actions.delivery.imprimirCupom', label: 'Imprimir cupom manualmente' },
    ],
  },
  {
    id: 'novo_pedido',
    label: 'Balcão',
    description: 'Venda rápida feita diretamente no balcão.',
    actions: [
      { path: 'actions.novo_pedido.finalizarVenda', label: 'Finalizar venda' },
      { path: 'actions.novo_pedido.descontoAcrescimo', label: 'Aplicar desconto ou acréscimo' },
      { path: 'actions.novo_pedido.vendaPrazo', label: 'Vender a prazo' },
    ],
  },
  {
    id: 'mesas',
    label: 'Mesa',
    description: 'Mesas, comandas e pedidos para consumo no local.',
    actions: [
      { path: 'actions.mesas.gerenciarMesa', label: 'Abrir, trocar, reabrir ou cancelar mesa' },
      { path: 'actions.mesas.lancarItens', label: 'Lançar itens' },
      { path: 'actions.mesas.fecharComanda', label: 'Fechar comanda ou imprimir conta parcial' },
      { path: 'actions.mesas.aceitarPedidoOnline', label: 'Aceitar, rejeitar ou excluir pedido online' },
      { path: 'actions.mesas.descontoAcrescimo', label: 'Aplicar desconto ou acréscimo' },
      { path: 'actions.mesas.vendaPrazo', label: 'Vender a prazo' },
    ],
  },
  {
    id: 'encomendas_pedidos',
    label: 'Encomendas',
    description: 'Agenda e operação de encomendas da confeitaria.',
    actions: [
      { path: 'actions.encomendas_pedidos.mudarStatus', label: 'Mudar status' },
      { path: 'actions.encomendas_pedidos.editarEncomenda', label: 'Editar encomenda' },
      { path: 'actions.encomendas_pedidos.lancarSinal', label: 'Lançar sinal no caixa' },
      { path: 'actions.encomendas_pedidos.reimprimir', label: 'Reimprimir comprovante' },
    ],
  },
];

const GLOBAL_OPTIONS: ActionOption[] = [
  { path: 'global.botaoRetaguarda', label: 'Mostrar botão Retaguarda' },
  { path: 'global.toggleDelivery', label: 'Permitir ligar ou desligar o Delivery' },
];

class AdminSecretChangedError extends Error {}

function isSameAdminSecret(value: any, expected: AdminSecret): boolean {
  return value?.salt === expected.salt && value?.passwordHash === expected.passwordHash;
}

function clonePermissions(value: PdvPermissions): PdvPermissions {
  return JSON.parse(JSON.stringify(value)) as PdvPermissions;
}

function getPathValue(value: PdvPermissions, path: PdvPermissionPath): boolean {
  return path.split('.').reduce<any>((current, part) => current?.[part], value) === true;
}

function setPathValue(value: PdvPermissions, path: PdvPermissionPath, checked: boolean): PdvPermissions {
  const copy = clonePermissions(value) as any;
  const parts = path.split('.');
  let target = copy;
  for (let index = 0; index < parts.length - 1; index += 1) {
    target[parts[index]] ??= {};
    target = target[parts[index]];
  }
  target[parts[parts.length - 1]] = checked;
  return copy;
}

function hasPermissionChanges(current: PdvPermissions, baseline: PdvPermissions): boolean {
  if (current.enabled !== baseline.enabled) return true;
  return PDV_PERMISSION_PATHS.some((path) => getPathValue(current, path) !== getPathValue(baseline, path));
}

type EditablePermissionPath = 'enabled' | PdvPermissionPath;
type PermissionChange = { path: EditablePermissionPath; value: boolean };

function applyPermissionChanges(base: PdvPermissions, changes: PermissionChange[]): PdvPermissions {
  let next = clonePermissions(base);
  for (const change of changes) {
    if (change.path === 'enabled') {
      next.enabled = change.value;
    } else {
      next = setPathValue(next, change.path, change.value);
    }
  }
  return next;
}

function rebasePermissionForm(
  current: PdvPermissions,
  previousBaseline: PdvPermissions,
  freshBaseline: PdvPermissions,
): PdvPermissions {
  let rebased = clonePermissions(freshBaseline);
  if (current.enabled !== previousBaseline.enabled) rebased.enabled = current.enabled;
  for (const path of PDV_PERMISSION_PATHS) {
    if (getPathValue(current, path) !== getPathValue(previousBaseline, path)) {
      rebased = setPathValue(rebased, path, getPathValue(current, path));
    }
  }
  return rebased;
}

export function PermissoesPdvTab({
  db,
  user,
  storeProfile,
  isProfileLoading,
  adminSecret,
  isAdminSecretLoading,
}: PermissoesPdvTabProps) {
  const { toast } = useToast();
  const initialPermissions = useMemo(() => getPdvPermissions(storeProfile), [storeProfile]);
  const [form, setForm] = useState<PdvPermissions>(initialPermissions);
  const baselineRef = useRef<PdvPermissions>(initialPermissions);
  const latestSnapshotRef = useRef<PdvPermissions>(initialPermissions);
  const pendingSaveRef = useRef<{ changes: PermissionChange[] } | null>(null);
  const failedSaveRef = useRef<{ changes: PermissionChange[]; baseline: PdvPermissions } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const passwordOperationRef = useRef(false);
  const isConfeitaria = storeProfile?.theme === 'confeitaria';

  useEffect(() => {
    if (isProfileLoading) return;
    const fresh = getPdvPermissions(storeProfile);
    latestSnapshotRef.current = fresh;
    // Firestore emits the local optimistic snapshot before updateDoc settles.
    // It is not a confirmed baseline until the write promise succeeds.
    if (pendingSaveRef.current) return;
    const previousBaseline = baselineRef.current;
    const failedSave = failedSaveRef.current;

    if (failedSave) {
      // Whether this is the optimistic event or Firestore's rollback, keep the
      // rejected leaves anchored to the last confirmed values. The form then
      // remains dirty without losing edits made while the request was pending.
      const confirmedFresh = applyPermissionChanges(
        fresh,
        failedSave.changes.map((change) => ({
          path: change.path,
          value: change.path === 'enabled'
            ? failedSave.baseline.enabled
            : getPathValue(failedSave.baseline, change.path),
        })),
      );
      setForm((previousForm) => rebasePermissionForm(previousForm, previousBaseline, confirmedFresh));
      baselineRef.current = confirmedFresh;
      failedSaveRef.current = null;
      return;
    }

    setForm((previousForm) => rebasePermissionForm(previousForm, previousBaseline, fresh));
    baselineRef.current = fresh;
  }, [isProfileLoading, storeProfile]);

  const isDirty = hasPermissionChanges(form, baselineRef.current);

  const handleSave = async () => {
    if (isProfileLoading || isSaving || pendingSaveRef.current || !isDirty) return;
    if (getEligibleTabs(form, storeProfile?.theme).length === 0) {
      toast({
        variant: 'destructive',
        title: 'Libere ao menos uma aba',
        description: 'O PDV precisa ter pelo menos uma aba disponível para o tema atual.',
      });
      return;
    }

    const updates: Record<string, any> = {};
    const changes: PermissionChange[] = [];
    if (form.enabled !== baselineRef.current.enabled) {
      updates['pdvPermissions.enabled'] = form.enabled;
      changes.push({ path: 'enabled', value: form.enabled });
    }
    for (const path of PDV_PERMISSION_PATHS) {
      const nextValue = getPathValue(form, path);
      if (nextValue !== getPathValue(baselineRef.current, path)) {
        updates[`pdvPermissions.${path}`] = nextValue;
        changes.push({ path, value: nextValue });
      }
    }
    updates['pdvPermissions.updatedAt'] = serverTimestamp();
    updates['pdvPermissions.updatedBy'] = user.uid;

    failedSaveRef.current = null;
    pendingSaveRef.current = { changes };
    setIsSaving(true);
    try {
      await updateDoc(doc(db, 'store_profiles', user.uid), updates);
      const previousBaseline = baselineRef.current;
      const confirmedBaseline = applyPermissionChanges(latestSnapshotRef.current, changes);
      pendingSaveRef.current = null;
      failedSaveRef.current = null;
      baselineRef.current = confirmedBaseline;
      setForm((current) => rebasePermissionForm(current, previousBaseline, confirmedBaseline));
      toast({ title: 'Permissões salvas', description: 'O PDV aberto recebe as alterações em tempo real.' });
    } catch (error) {
      // Keep the submitted values over the confirmed remote baseline. A
      // rollback snapshot received after this point is rebased as remote data,
      // so these local values stay dirty and can be retried.
      failedSaveRef.current = { changes, baseline: clonePermissions(baselineRef.current) };
      pendingSaveRef.current = null;
      console.error('Erro ao salvar permissões do PDV:', error);
      toast({
        variant: 'destructive',
        title: 'Não foi possível salvar',
        description: 'As alterações continuam nesta tela. Tente novamente.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRestore = () => {
    let restored = clonePermissions(form);
    restored.enabled = true;
    for (const path of PDV_PERMISSION_PATHS) {
      restored = setPathValue(restored, path, true);
    }
    setForm(restored);
  };

  const validateNewPassword = () => {
    if (newPassword.length < 4) {
      toast({ variant: 'destructive', title: 'Senha muito curta', description: 'Use pelo menos 4 caracteres.' });
      return false;
    }
    if (newPassword !== confirmPassword) {
      toast({ variant: 'destructive', title: 'As senhas não conferem' });
      return false;
    }
    return true;
  };

  const handleSavePassword = async () => {
    if (passwordOperationRef.current || !validateNewPassword()) return;
    passwordOperationRef.current = true;
    setIsSavingPassword(true);
    try {
      if (adminSecret && !(await verifyAdminPassword(currentPassword, adminSecret))) {
        toast({ variant: 'destructive', title: 'Senha atual incorreta' });
        return;
      }
      const secret = await createAdminSecret(newPassword);
      const secretRef = doc(db, 'admin_secrets', user.uid);
      await runTransaction(db, async (transaction) => {
        const latestSnapshot = await transaction.get(secretRef);
        if (adminSecret) {
          if (!latestSnapshot.exists() || !isSameAdminSecret(latestSnapshot.data(), adminSecret)) {
            throw new AdminSecretChangedError('A senha foi alterada em outra sessão.');
          }
        } else if (latestSnapshot.exists()) {
          throw new AdminSecretChangedError('Uma senha foi criada em outra sessão.');
        }
        transaction.set(secretRef, { ...secret, updatedAt: serverTimestamp() });
      });
      unlockAdminSession(user.uid, secret);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast({ title: adminSecret ? 'Senha alterada' : 'Senha criada', description: 'Guarde bem esta senha.' });
    } catch (error) {
      console.error('Erro ao salvar senha administrativa:', error);
      toast({
        variant: 'destructive',
        title: error instanceof AdminSecretChangedError ? 'Senha atualizada em outra sessão' : 'Não foi possível salvar a senha',
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      passwordOperationRef.current = false;
      setIsSavingPassword(false);
    }
  };

  const handleRemovePassword = async () => {
    if (!adminSecret || passwordOperationRef.current) return;
    passwordOperationRef.current = true;
    setIsSavingPassword(true);
    try {
      if (!(await verifyAdminPassword(currentPassword, adminSecret))) {
        toast({ variant: 'destructive', title: 'Senha atual incorreta' });
        return;
      }
      if (!window.confirm('Remover a senha da Retaguarda? O acesso voltará a ser direto.')) return;
      const secretRef = doc(db, 'admin_secrets', user.uid);
      await runTransaction(db, async (transaction) => {
        const latestSnapshot = await transaction.get(secretRef);
        if (!latestSnapshot.exists() || !isSameAdminSecret(latestSnapshot.data(), adminSecret)) {
          throw new AdminSecretChangedError('A senha foi alterada em outra sessão.');
        }
        transaction.delete(secretRef);
      });
      clearAdminSession(user.uid);
      setCurrentPassword('');
      toast({ title: 'Senha removida' });
    } catch (error) {
      console.error('Erro ao remover senha administrativa:', error);
      toast({
        variant: 'destructive',
        title: error instanceof AdminSecretChangedError ? 'Senha atualizada em outra sessão' : 'Não foi possível remover a senha',
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      passwordOperationRef.current = false;
      setIsSavingPassword(false);
    }
  };

  if (isProfileLoading) {
    return (
      <div className="flex min-h-64 items-center justify-center text-slate-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando permissões…
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 pb-10">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-800">
          <ShieldCheck className="h-7 w-7 text-emerald-600" /> Permissões do PDV
        </h1>
        <p className="mt-1 text-sm text-slate-500">Escolha o que fica disponível para quem opera a frente de caixa.</p>
      </div>

      <Alert className="border-amber-200 bg-amber-50 text-amber-950">
        <TriangleAlert className="h-4 w-4" />
        <AlertTitle>Controle de interface</AlertTitle>
        <AlertDescription>
          Estas opções organizam o PDV e evitam alterações por acidente ou curiosidade. Elas não substituem contas de operador separadas contra alguém com conhecimento técnico.
        </AlertDescription>
      </Alert>

      <Card className="border-emerald-200">
        <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Aplicar permissões no PDV</CardTitle>
            <CardDescription>Desligue para liberar tudo imediatamente sem apagar esta configuração.</CardDescription>
          </div>
          <Switch disabled={isSaving} checked={form.enabled} onCheckedChange={(enabled) => setForm((current) => ({ ...current, enabled }))} />
        </CardHeader>
      </Card>

      {TAB_OPTIONS.filter((tab) => tab.id !== 'encomendas_pedidos' || isConfeitaria).map((tab) => {
        const tabPath = `tabs.${tab.id}` as PdvPermissionPath;
        const isVisible = getPathValue(form, tabPath);
        return (
          <Card key={tab.id}>
            <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
              <div>
                <CardTitle>{tab.label}</CardTitle>
                <CardDescription>{tab.description}</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor={`tab-${tab.id}`} className="whitespace-nowrap">Aba visível</Label>
                <Switch
                  id={`tab-${tab.id}`}
                  disabled={isSaving}
                  checked={isVisible}
                  onCheckedChange={(checked) => setForm((current) => setPathValue(current, tabPath, checked))}
                />
              </div>
            </CardHeader>
            <CardContent className={`grid gap-3 sm:grid-cols-2 ${isVisible ? '' : 'opacity-45'}`}>
              {tab.actions.map((action) => (
                <label key={action.path} className="flex items-center justify-between gap-4 rounded-lg border bg-slate-50 px-3 py-3 text-sm">
                  <span>{action.label}</span>
                  <Switch
                    checked={getPathValue(form, action.path)}
                    disabled={isSaving || !isVisible}
                    onCheckedChange={(checked) => setForm((current) => setPathValue(current, action.path, checked))}
                  />
                </label>
              ))}
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardHeader>
          <CardTitle>Controles gerais</CardTitle>
          <CardDescription>Itens do topo do PDV que não pertencem a uma aba.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {GLOBAL_OPTIONS.map((option) => (
            <label key={option.path} className="flex items-center justify-between gap-4 rounded-lg border bg-slate-50 px-3 py-3 text-sm">
              <span>{option.label}</span>
              <Switch
                disabled={isSaving}
                checked={getPathValue(form, option.path)}
                onCheckedChange={(checked) => setForm((current) => setPathValue(current, option.path, checked))}
              />
            </label>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" /> Senha do administrador</CardTitle>
          <CardDescription>
            Protege a Retaguarda e libera o Modo Dono no PDV. A sessão da Retaguarda fica desbloqueada por 30 minutos nesta aba.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isAdminSecretLoading ? (
            <p className="flex items-center text-sm text-slate-500"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verificando senha…</p>
          ) : (
            <>
              {adminSecret && (
                <div className="space-y-2">
                  <Label htmlFor="current-admin-password">Senha atual</Label>
                  <Input id="current-admin-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="new-admin-password">{adminSecret ? 'Nova senha' : 'Criar senha'}</Label>
                  <Input id="new-admin-password" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-admin-password">Confirmar nova senha</Label>
                  <Input id="confirm-admin-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
                </div>
              </div>
              <p className="text-xs text-amber-700">Não há recuperação automática nesta fase. Guarde bem a senha; em caso de esquecimento, o suporte precisará removê-la.</p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={handleSavePassword} disabled={isSavingPassword || !newPassword || !confirmPassword || (!!adminSecret && !currentPassword)}>
                  {isSavingPassword && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {adminSecret ? 'Alterar senha' : 'Definir senha'}
                </Button>
                {adminSecret && (
                  <Button variant="destructive" onClick={handleRemovePassword} disabled={isSavingPassword || !currentPassword}>
                    Remover senha
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Separator />
      <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 rounded-xl border bg-white/95 p-3 shadow-lg backdrop-blur">
        <Button variant="outline" onClick={handleRestore} disabled={isSaving}>
          <RotateCcw className="mr-2 h-4 w-4" /> Restaurar padrão
        </Button>
        <Button onClick={handleSave} disabled={!isDirty || isSaving || isProfileLoading}>
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Salvar alterações
        </Button>
      </div>
    </div>
  );
}
