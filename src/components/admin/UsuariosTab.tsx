'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import {
  CircleAlert,
  KeyRound,
  Loader2,
  LockKeyhole,
  Mail,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  UserX,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import {
  type PdvPermissionPath,
  type PdvPermissions,
  type PdvTabId,
} from '@/lib/pdv-permissions';
import {
  createEmptyOperatorPermissions,
  normalizeOperatorPermissions,
  OWNER_ONLY_RETAGUARDA_PERMISSIONS,
  RETAGUARDA_PERMISSION_KEYS,
  type OperatorPermissions,
  type RetaguardaPermissionKey,
} from '@/lib/user-permissions';

interface UsuariosTabProps {
  user: User;
}

interface ManagedUser {
  uid: string;
  name: string;
  email: string;
  active: boolean;
  permissions: OperatorPermissions;
  emailVerified: boolean;
  authDisabled: boolean;
  authMissing: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

interface UserFormState {
  uid: string | null;
  name: string;
  email: string;
  permissions: OperatorPermissions;
}

interface PdvActionOption {
  path: PdvPermissionPath;
  label: string;
  description?: string;
  ownerOnly?: boolean;
}

interface PdvTabOption {
  id: PdvTabId;
  label: string;
  description: string;
  actions: PdvActionOption[];
}

interface ConfirmationState {
  kind: 'toggle-active' | 'remove';
  usuario: ManagedUser;
}

const PDV_TAB_OPTIONS: PdvTabOption[] = [
  {
    id: 'caixa',
    label: 'Caixa',
    description: 'Abertura, fechamento e movimentações do caixa atual.',
    actions: [
      { path: 'actions.caixa.abrirCaixa', label: 'Abrir caixa' },
      { path: 'actions.caixa.fecharCaixa', label: 'Fechar caixa' },
      { path: 'actions.caixa.suprimento', label: 'Fazer suprimento manual' },
      { path: 'actions.caixa.sangria', label: 'Fazer sangria manual' },
      { path: 'actions.caixa.cancelarVenda', label: 'Cancelar ou reativar venda' },
      {
        path: 'actions.caixa.verCaixasAnteriores',
        label: 'Ver caixas anteriores',
        description: 'Histórico financeiro agregado é exclusivo do master.',
        ownerOnly: true,
      },
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
      {
        path: 'actions.novo_pedido.vendaPrazo',
        label: 'Vender a prazo',
        description: 'Conta da Casa permanece exclusiva do master até a base de clientes ser separada.',
        ownerOnly: true,
      },
    ],
  },
  {
    id: 'mesas',
    label: 'Mesas',
    description: 'Mesas, comandas e pedidos para consumo no local.',
    actions: [
      { path: 'actions.mesas.gerenciarMesa', label: 'Abrir, trocar, reabrir ou cancelar mesa' },
      { path: 'actions.mesas.lancarItens', label: 'Lançar itens' },
      { path: 'actions.mesas.fecharComanda', label: 'Fechar comanda ou imprimir conta parcial' },
      { path: 'actions.mesas.aceitarPedidoOnline', label: 'Aceitar, rejeitar ou excluir pedido online' },
      { path: 'actions.mesas.descontoAcrescimo', label: 'Aplicar desconto ou acréscimo' },
      {
        path: 'actions.mesas.vendaPrazo',
        label: 'Vender a prazo',
        description: 'Conta da Casa permanece exclusiva do master até a base de clientes ser separada.',
        ownerOnly: true,
      },
    ],
  },
  {
    id: 'encomendas_pedidos',
    label: 'Encomendas no PDV',
    description: 'Agenda e operação de encomendas da confeitaria.',
    actions: [
      { path: 'actions.encomendas_pedidos.mudarStatus', label: 'Mudar status' },
      { path: 'actions.encomendas_pedidos.editarEncomenda', label: 'Editar encomenda' },
      { path: 'actions.encomendas_pedidos.lancarSinal', label: 'Lançar sinal no caixa' },
      { path: 'actions.encomendas_pedidos.reimprimir', label: 'Reimprimir comprovante' },
    ],
  },
];

const GLOBAL_OPTIONS: PdvActionOption[] = [
  { path: 'global.botaoRetaguarda', label: 'Mostrar botão Retaguarda' },
  { path: 'global.toggleDelivery', label: 'Permitir ligar ou desligar o Delivery' },
];

const RETAGUARDA_LABELS: Record<RetaguardaPermissionKey, { label: string; description: string }> = {
  dashboard: { label: 'Dashboard', description: 'Relatórios e faturamento agregado.' },
  produtos: { label: 'Produtos', description: 'Consulta do catálogo; alterações continuam bloqueadas.' },
  categorias: { label: 'Categorias', description: 'Consulta das categorias; alterações continuam bloqueadas.' },
  adicionais: { label: 'Adicionais', description: 'Consulta dos adicionais; alterações continuam bloqueadas.' },
  clientes: { label: 'Clientes', description: 'Base de clientes e dados pessoais.' },
  ofertas: { label: 'Ofertas', description: 'Consulta das promoções; alterações continuam bloqueadas.' },
  whatsapp: { label: 'WhatsApp', description: 'Configuração e histórico da integração.' },
  campanhas: { label: 'Campanhas', description: 'Disparos, listas e resultados de campanhas.' },
  encomendas: { label: 'Encomendas na Retaguarda', description: 'Visão administrativa e agenda completa.' },
  freelance: { label: 'Freelance', description: 'Cadastros e pagamentos de colaboradores.' },
  perfil: { label: 'Perfil da Loja', description: 'Configurações operacionais e públicas da loja.' },
  permissoes: { label: 'Permissões', description: 'Configuração das políticas da loja.' },
  usuarios: { label: 'Usuários', description: 'Criação e administração de identidades.' },
};

class UsuariosRequestError extends Error {}

function emptyForm(): UserFormState {
  return {
    uid: null,
    name: '',
    email: '',
    permissions: createEmptyOperatorPermissions(),
  };
}

function clonePermissions(value: OperatorPermissions): OperatorPermissions {
  return normalizeOperatorPermissions(JSON.parse(JSON.stringify(value)));
}

function getPdvPath(value: PdvPermissions, path: PdvPermissionPath): boolean {
  let current: unknown = value;
  for (const part of path.split('.')) {
    if (typeof current !== 'object' || current === null) return false;
    current = (current as Record<string, unknown>)[part];
  }
  return current === true;
}

function setPdvPath(value: PdvPermissions, path: PdvPermissionPath, checked: boolean): PdvPermissions {
  const copy = JSON.parse(JSON.stringify(value)) as Record<string, any>;
  const parts = path.split('.');
  let current = copy;
  for (let index = 0; index < parts.length - 1; index += 1) {
    current[parts[index]] ??= {};
    current = current[parts[index]];
  }
  current[parts[parts.length - 1]] = checked;
  return normalizeOperatorPermissions({ pdv: copy }).pdv;
}

function coerceManagedUser(value: unknown): ManagedUser | null {
  if (typeof value !== 'object' || value === null) return null;
  const source = value as Record<string, unknown>;
  if (typeof source.uid !== 'string') return null;
  return {
    uid: source.uid,
    name: typeof source.name === 'string' ? source.name : '',
    email: typeof source.email === 'string' ? source.email : '',
    active: source.active === true,
    permissions: normalizeOperatorPermissions(source.permissions),
    emailVerified: source.emailVerified === true,
    authDisabled: source.authDisabled === true,
    authMissing: source.authMissing === true,
    createdAt: typeof source.createdAt === 'string' ? source.createdAt : null,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : null,
  };
}

function hasUsableAccess(permissions: OperatorPermissions): boolean {
  const hasPdvTab = Object.values(permissions.pdv.tabs).some((value) => value === true);
  const hasReadOnlyModule = RETAGUARDA_PERMISSION_KEYS.some(
    (key) => !OWNER_ONLY_RETAGUARDA_PERMISSIONS.has(key) && permissions.retaguarda[key] === true,
  );
  return hasPdvTab || hasReadOnlyModule;
}

function formatCreatedAt(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(date);
}

export function UsuariosTab({ user }: UsuariosTabProps) {
  const { toast } = useToast();
  const [usuarios, setUsuarios] = useState<ManagedUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<UserFormState>(() => emptyForm());
  const [formError, setFormError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [busyAction, setBusyAction] = useState<{ uid: string; action: string } | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(null);
  const operationRef = useRef(false);
  const loadSequenceRef = useRef(0);

  const request = useCallback(async <T,>(method: string, body?: unknown, suffix = ''): Promise<T> => {
    const token = await user.getIdToken();
    const response = await fetch(`/api/usuarios${suffix}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: 'no-store',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new UsuariosRequestError(
        typeof data?.error === 'string' ? data.error : 'Não foi possível concluir a operação.',
      );
    }
    return data as T;
  }, [user]);

  const loadUsers = useCallback(async () => {
    const sequence = ++loadSequenceRef.current;
    setIsLoading(true);
    setLoadError('');
    try {
      const data = await request<{ usuarios?: unknown[] }>('GET');
      if (sequence !== loadSequenceRef.current) return;
      const nextUsers = (Array.isArray(data.usuarios) ? data.usuarios : [])
        .map(coerceManagedUser)
        .filter((value): value is ManagedUser => value !== null);
      setUsuarios(nextUsers);
    } catch (error) {
      if (sequence !== loadSequenceRef.current) return;
      setLoadError(error instanceof Error ? error.message : 'Não foi possível carregar os usuários.');
    } finally {
      if (sequence === loadSequenceRef.current) setIsLoading(false);
    }
  }, [request]);

  useEffect(() => {
    void loadUsers();
    return () => {
      loadSequenceRef.current += 1;
    };
  }, [loadUsers]);

  const activeCount = useMemo(() => usuarios.filter((usuario) => usuario.active).length, [usuarios]);
  const hasPendingAction = busyAction !== null;

  const openNewUser = () => {
    if (operationRef.current) return;
    setForm(emptyForm());
    setFormError('');
    setDialogOpen(true);
  };

  const openEditUser = (usuario: ManagedUser) => {
    if (operationRef.current) return;
    setForm({
      uid: usuario.uid,
      name: usuario.name,
      email: usuario.email,
      permissions: clonePermissions(usuario.permissions),
    });
    setFormError('');
    setDialogOpen(true);
  };

  const updatePdvPermission = (path: PdvPermissionPath, checked: boolean) => {
    setForm((current) => ({
      ...current,
      permissions: {
        ...current.permissions,
        pdv: setPdvPath(current.permissions.pdv, path, checked),
      },
    }));
    setFormError('');
  };

  const updateRetaguardaPermission = (key: RetaguardaPermissionKey, checked: boolean) => {
    if (OWNER_ONLY_RETAGUARDA_PERMISSIONS.has(key)) return;
    setForm((current) => ({
      ...current,
      permissions: normalizeOperatorPermissions({
        ...current.permissions,
        retaguarda: { ...current.permissions.retaguarda, [key]: checked },
      }),
    }));
    setFormError('');
  };

  const upsertUser = (usuario: ManagedUser) => {
    setUsuarios((current) => {
      const exists = current.some((item) => item.uid === usuario.uid);
      const next = exists
        ? current.map((item) => (item.uid === usuario.uid ? usuario : item))
        : [...current, usuario];
      return next.sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
    });
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (operationRef.current) return;
    const name = form.name.trim();
    const email = form.email.trim();
    if (!name) {
      setFormError('Informe o nome do usuário.');
      return;
    }
    if (!form.uid && !/^\S+@\S+\.\S+$/.test(email)) {
      setFormError('Informe um e-mail válido.');
      return;
    }
    if (!hasUsableAccess(form.permissions)) {
      setFormError('Libere ao menos uma aba do PDV ou um módulo de consulta da Retaguarda.');
      return;
    }

    operationRef.current = true;
    setIsSaving(true);
    setFormError('');
    try {
      const data = form.uid
        ? await request<{ usuario?: unknown }>('PATCH', {
          uid: form.uid,
          name,
          permissions: form.permissions,
        })
        : await request<{ usuario?: unknown; inviteSent?: boolean; warning?: string }>('POST', {
          name,
          email,
          permissions: form.permissions,
        });
      const savedUser = coerceManagedUser(data.usuario);
      if (!savedUser) throw new UsuariosRequestError('A API retornou um usuário inválido.');
      upsertUser(savedUser);
      setDialogOpen(false);
      setForm(emptyForm());
      toast({
        title: form.uid
          ? 'Usuário atualizado'
          : 'inviteSent' in data && data.inviteSent === false
            ? 'Usuário criado; convite pendente'
            : 'Usuário criado',
        description: 'warning' in data && typeof data.warning === 'string'
          ? data.warning
          : form.uid
            ? 'As permissões novas entram em vigor em tempo real.'
            : 'O convite para definir a senha foi enviado por e-mail.',
      });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Não foi possível salvar o usuário.');
    } finally {
      operationRef.current = false;
      setIsSaving(false);
    }
  };

  const handleResendInvite = async (usuario: ManagedUser) => {
    if (operationRef.current || usuario.authMissing) return;
    operationRef.current = true;
    setBusyAction({ uid: usuario.uid, action: 'invite' });
    try {
      await request('PATCH', { uid: usuario.uid, action: 'resend_invite' });
      toast({ title: 'Convite reenviado', description: `Enviamos um novo link para ${usuario.email}.` });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Não foi possível reenviar',
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      operationRef.current = false;
      setBusyAction(null);
    }
  };

  const handleConfirmedAction = async () => {
    const pending = confirmation;
    if (!pending || operationRef.current) return;
    operationRef.current = true;
    setBusyAction({ uid: pending.usuario.uid, action: pending.kind });
    setConfirmation(null);
    try {
      if (pending.kind === 'remove') {
        await request('DELETE', undefined, `?uid=${encodeURIComponent(pending.usuario.uid)}`);
        setUsuarios((current) => current.filter((item) => item.uid !== pending.usuario.uid));
        toast({ title: 'Usuário removido', description: 'O login e o vínculo com a loja foram excluídos.' });
      } else {
        const data = await request<{ usuario?: unknown }>('PATCH', {
          uid: pending.usuario.uid,
          active: !pending.usuario.active,
        });
        const updatedUser = coerceManagedUser(data.usuario);
        if (!updatedUser) throw new UsuariosRequestError('A API retornou um usuário inválido.');
        upsertUser(updatedUser);
        toast({
          title: updatedUser.active ? 'Usuário ativado' : 'Usuário desativado',
          description: updatedUser.active
            ? 'O login voltou a ter acesso ao perfil configurado.'
            : 'Sessões abertas deixam de acessar os dados da loja pelas regras do servidor.',
        });
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: pending.kind === 'remove' ? 'Não foi possível remover' : 'Não foi possível alterar o acesso',
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      operationRef.current = false;
      setBusyAction(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 pb-10">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-800">
            <Users className="h-7 w-7 text-emerald-600" /> Usuários
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Cada funcionário entra com o próprio e-mail e recebe somente o acesso configurado.
          </p>
        </div>
        <Button onClick={openNewUser} disabled={isLoading || Boolean(loadError) || hasPendingAction}>
          <UserPlus className="h-4 w-4" /> Novo usuário
        </Button>
      </div>

      <Alert className="border-emerald-200 bg-emerald-50 text-emerald-950">
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>Identidade e dados sensíveis protegidos no servidor</AlertTitle>
        <AlertDescription>
          Desativar corta todo o acesso pelas regras do Firebase, e os módulos sensíveis continuam exclusivos do master. Os controles de ações do PDV também limitam o que aparece e pode ser acionado no aplicativo.
        </AlertDescription>
      </Alert>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((item) => (
            <Card key={item}>
              <CardHeader><Skeleton className="h-6 w-44" /><Skeleton className="h-4 w-56" /></CardHeader>
              <CardContent><Skeleton className="h-9 w-full" /></CardContent>
            </Card>
          ))}
        </div>
      ) : loadError ? (
        <Alert variant="destructive">
          <CircleAlert className="h-4 w-4" />
          <AlertTitle>Não foi possível carregar os usuários</AlertTitle>
          <AlertDescription className="mt-2 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{loadError}</span>
            <Button variant="outline" size="sm" onClick={() => void loadUsers()}>
              <RefreshCw className="h-4 w-4" /> Tentar novamente
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 text-sm text-slate-600">
            <Badge variant="secondary">{usuarios.length} {usuarios.length === 1 ? 'usuário' : 'usuários'}</Badge>
            <Badge variant="outline">{activeCount} {activeCount === 1 ? 'ativo' : 'ativos'}</Badge>
          </div>

          {usuarios.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex min-h-48 flex-col items-center justify-center gap-3 text-center">
                <Users className="h-10 w-10 text-slate-300" />
                <div>
                  <p className="font-semibold text-slate-700">Nenhum funcionário cadastrado</p>
                  <p className="text-sm text-slate-500">Crie o primeiro login e escolha exatamente o que ele poderá acessar.</p>
                </div>
                <Button onClick={openNewUser}><UserPlus className="h-4 w-4" /> Criar usuário</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {usuarios.map((usuario) => {
                const isBusy = busyAction?.uid === usuario.uid;
                const createdAt = formatCreatedAt(usuario.createdAt);
                return (
                  <Card key={usuario.uid} className={usuario.active ? '' : 'bg-slate-50 opacity-80'}>
                    <CardHeader className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <CardTitle className="truncate text-lg">{usuario.name || 'Sem nome'}</CardTitle>
                          <CardDescription className="truncate">{usuario.email || 'Login do Auth não encontrado'}</CardDescription>
                        </div>
                        <Badge variant={usuario.active ? 'default' : 'secondary'} className={usuario.active ? 'bg-emerald-600' : ''}>
                          {usuario.active ? 'Ativo' : 'Inativo'}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {usuario.authMissing && <Badge variant="destructive">Auth ausente</Badge>}
                        {usuario.authDisabled && <Badge variant="destructive">Auth bloqueado</Badge>}
                        {usuario.emailVerified && <Badge variant="outline">E-mail confirmado</Badge>}
                        {createdAt && <span className="text-xs text-slate-400">Criado em {createdAt}</span>}
                      </div>
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-2 border-t pt-4">
                      <Button size="sm" variant="outline" onClick={() => openEditUser(usuario)} disabled={hasPendingAction}>
                        <Pencil className="h-4 w-4" /> Editar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleResendInvite(usuario)}
                        disabled={hasPendingAction || usuario.authMissing || !usuario.email}
                      >
                        {isBusy && busyAction?.action === 'invite' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                        Reenviar convite
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setConfirmation({ kind: 'toggle-active', usuario })}
                        disabled={hasPendingAction || usuario.authMissing}
                      >
                        {isBusy && busyAction?.action === 'toggle-active'
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : usuario.active ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                        {usuario.active ? 'Desativar' : 'Ativar'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-600 hover:bg-red-50 hover:text-red-700"
                        onClick={() => setConfirmation({ kind: 'remove', usuario })}
                        disabled={hasPendingAction}
                      >
                        {isBusy && busyAction?.action === 'remove' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        Remover
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => !isSaving && setDialogOpen(open)}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.uid ? 'Editar usuário' : 'Novo usuário'}</DialogTitle>
            <DialogDescription>
              {form.uid
                ? 'Altere o nome e o perfil de acesso. O e-mail e o vínculo com a loja não podem ser trocados.'
                : 'O funcionário receberá um e-mail do Firebase para definir a própria senha.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSave} className="space-y-5">
            <Card>
              <CardHeader><CardTitle className="text-base">Identificação</CardTitle></CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="operator-name">Nome</Label>
                  <Input
                    id="operator-name"
                    value={form.name}
                    maxLength={100}
                    autoComplete="name"
                    disabled={isSaving}
                    onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="operator-email">E-mail de login</Label>
                  <Input
                    id="operator-email"
                    type="email"
                    value={form.email}
                    autoComplete="email"
                    readOnly={Boolean(form.uid)}
                    disabled={isSaving}
                    className={form.uid ? 'bg-slate-100' : ''}
                    onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                  />
                  {form.uid && <p className="text-xs text-slate-500">Para trocar o e-mail, remova este login e crie outro.</p>}
                </div>
              </CardContent>
            </Card>

            <div>
              <h3 className="text-lg font-bold text-slate-800">Permissões do PDV</h3>
              <p className="text-sm text-slate-500">A aba define onde o usuário entra; as opções limitam o que ele faz nela.</p>
            </div>

            {PDV_TAB_OPTIONS.map((tab) => {
              const tabPath = `tabs.${tab.id}` as PdvPermissionPath;
              const tabEnabled = getPdvPath(form.permissions.pdv, tabPath);
              return (
                <Card key={tab.id}>
                  <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                    <div>
                      <CardTitle className="text-base">{tab.label}</CardTitle>
                      <CardDescription>{tab.description}</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`operator-tab-${tab.id}`} className="whitespace-nowrap">Aba visível</Label>
                      <Switch
                        id={`operator-tab-${tab.id}`}
                        checked={tabEnabled}
                        disabled={isSaving}
                        onCheckedChange={(checked) => updatePdvPermission(tabPath, checked)}
                      />
                    </div>
                  </CardHeader>
                  <CardContent className={`grid gap-3 sm:grid-cols-2 ${tabEnabled ? '' : 'opacity-50'}`}>
                    {tab.actions.map((action) => {
                      const locked = action.ownerOnly === true;
                      return (
                        <div key={action.path} className="flex items-center justify-between gap-4 rounded-lg border bg-slate-50 p-3">
                          <div className="min-w-0 text-sm">
                            <div className="flex items-center gap-2 font-medium">
                              {locked && <LockKeyhole className="h-3.5 w-3.5 text-amber-600" />}
                              <span>{action.label}</span>
                            </div>
                            {action.description && <p className="mt-1 text-xs text-amber-700">{action.description}</p>}
                          </div>
                          <Switch
                            aria-label={action.label}
                            checked={!locked && getPdvPath(form.permissions.pdv, action.path)}
                            disabled={isSaving || !tabEnabled || locked}
                            onCheckedChange={(checked) => updatePdvPermission(action.path, checked)}
                          />
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              );
            })}

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Controles gerais do PDV</CardTitle>
                <CardDescription>Itens do topo que não pertencem a uma aba específica.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                {GLOBAL_OPTIONS.map((option) => (
                  <div key={option.path} className="flex items-center justify-between gap-4 rounded-lg border bg-slate-50 p-3 text-sm">
                    <span>{option.label}</span>
                    <Switch
                      aria-label={option.label}
                      checked={getPdvPath(form.permissions.pdv, option.path)}
                      disabled={isSaving}
                      onCheckedChange={(checked) => updatePdvPermission(option.path, checked)}
                    />
                  </div>
                ))}
              </CardContent>
            </Card>

            <Separator />
            <div>
              <h3 className="text-lg font-bold text-slate-800">Retaguarda</h3>
              <p className="text-sm text-slate-500">
                Nesta fase, operadores recebem somente consulta de cadastros. Módulos com dados sensíveis continuam exclusivos do master.
              </p>
            </div>

            <Card>
              <CardContent className="grid gap-3 pt-6 sm:grid-cols-2">
                {RETAGUARDA_PERMISSION_KEYS.map((key) => {
                  const item = RETAGUARDA_LABELS[key];
                  const ownerOnly = OWNER_ONLY_RETAGUARDA_PERMISSIONS.has(key);
                  return (
                    <div key={key} className={`flex items-center justify-between gap-4 rounded-lg border p-3 ${ownerOnly ? 'bg-amber-50/60' : 'bg-slate-50'}`}>
                      <div className="min-w-0 text-sm">
                        <div className="flex flex-wrap items-center gap-2 font-medium">
                          {ownerOnly && <LockKeyhole className="h-3.5 w-3.5 text-amber-600" />}
                          <span>{item.label}</span>
                          <Badge variant="outline" className={ownerOnly ? 'border-amber-300 text-amber-700' : 'border-sky-300 text-sky-700'}>
                            {ownerOnly ? 'Só master' : 'Somente leitura'}
                          </Badge>
                        </div>
                        <p className={`mt-1 text-xs ${ownerOnly ? 'text-amber-700' : 'text-slate-500'}`}>{item.description}</p>
                      </div>
                      <Switch
                        aria-label={item.label}
                        checked={!ownerOnly && form.permissions.retaguarda[key]}
                        disabled={isSaving || ownerOnly}
                        onCheckedChange={(checked) => updateRetaguardaPermission(key, checked)}
                      />
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {formError && (
              <Alert variant="destructive">
                <CircleAlert className="h-4 w-4" />
                <AlertTitle>Revise os dados</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <DialogFooter className="sticky -bottom-6 -mx-6 border-t bg-white/95 p-4 backdrop-blur">
              <Button type="button" variant="outline" disabled={isSaving} onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : form.uid ? <Pencil className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
                {isSaving ? 'Salvando…' : form.uid ? 'Salvar alterações' : 'Criar e enviar convite'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(confirmation)} onOpenChange={(open) => !open && setConfirmation(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmation?.kind === 'remove'
                ? `Remover ${confirmation.usuario.name}?`
                : confirmation?.usuario.active
                  ? `Desativar ${confirmation.usuario.name}?`
                  : `Ativar ${confirmation?.usuario.name}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmation?.kind === 'remove'
                ? 'O login será apagado do Firebase Auth e não poderá ser recuperado. Pedidos e históricos da loja serão preservados.'
                : confirmation?.usuario.active
                  ? 'O usuário perderá imediatamente o acesso aos dados da loja, inclusive em sessões que já estejam abertas.'
                  : 'O usuário voltará a acessar somente as abas e módulos configurados no perfil atual.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className={confirmation?.kind === 'remove' ? 'bg-red-600 hover:bg-red-700' : ''}
              onClick={() => void handleConfirmedAction()}
            >
              {confirmation?.kind === 'remove' ? 'Remover definitivamente' : confirmation?.usuario.active ? 'Desativar' : 'Ativar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
