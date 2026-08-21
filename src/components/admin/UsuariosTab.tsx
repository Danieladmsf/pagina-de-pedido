'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import type { AdminSecret } from '@/lib/admin-password';
import { AdminPasswordSection } from '@/components/admin/AdminPasswordSection';
import {
  CircleAlert,
  Copy,
  Eye,
  EyeOff,
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
  generateOperatorPassword,
  resolveOperatorLogin,
  suggestOperatorHandle,
  validateOperatorPassword,
} from '@/lib/operator-login';
import {
  type PdvPermissionPath,
  type PdvPermissions,
  type PdvTabId,
} from '@/lib/pdv-permissions';
import {
  createEmptyOperatorPermissions,
  normalizeOperatorPermissions,
  RETAGUARDA_PERMISSION_KEYS,
  RETAGUARDA_SOMENTE_LEITURA,
  type OperatorPermissions,
  type RetaguardaPermissionKey,
} from '@/lib/user-permissions';

interface UsuariosTabProps {
  user: User;
  db: Firestore;
  adminSecret: (AdminSecret & { id?: string }) | null;
  isAdminSecretLoading: boolean;
}

interface ManagedUser {
  uid: string;
  name: string;
  email: string;
  /** Apelido ("maria") ou o e-mail completo — é o que o funcionário digita. */
  login: string;
  /** Endereço interno de apelido não recebe e-mail; só o dono troca a senha. */
  canReceiveEmail: boolean;
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
  login: string;
  password: string;
  /** Enquanto o dono não mexe no login, ele acompanha o nome digitado. */
  loginTocado: boolean;
  permissions: OperatorPermissions;
}

/** O que o dono precisa anotar e entregar ao funcionário. */
interface CredenciaisEntregues {
  nome: string;
  login: string;
  password: string;
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

function descreveLogin(usuario: ManagedUser): string {
  if (!usuario.login) return 'Login não encontrado';
  return usuario.canReceiveEmail ? usuario.login : 'usuário: ' + usuario.login;
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
        description: 'Só você vê o histórico e os totais de caixas anteriores.',
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
        description: 'A venda no fiado (Conta da Casa) fica só com você por enquanto.',
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
        description: 'A venda no fiado (Conta da Casa) fica só com você por enquanto.',
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

interface RetaguardaModuleOption {
  key: RetaguardaPermissionKey;
  label: string;
  description: string;
  /** Aviso em destaque: ligar isso tem consequência que não é óbvia. */
  alerta?: string;
}

interface RetaguardaGroupOption {
  titulo: string;
  descricao: string;
  modulos: RetaguardaModuleOption[];
}

/** Um item por tela do menu lateral — é o mapa do que existe para liberar. */
const RETAGUARDA_GROUPS: RetaguardaGroupOption[] = [
  {
    titulo: 'Números do negócio',
    descricao: 'Quanto entrou, o que vendeu e quem passou no cardápio.',
    modulos: [
      { key: 'dashboard', label: 'Dashboard', description: 'Vendas do dia, formas de pagamento e canais.' },
      { key: 'relatorios', label: 'Relatórios', description: 'Faturamento mês a mês e a curva de cada produto.' },
      { key: 'visitantes', label: 'Visitantes', description: 'Quem abriu o cardápio e o que ficou no carrinho.' },
    ],
  },
  {
    titulo: 'Cardápio',
    descricao: 'O que a loja vende, por quanto e o que ainda tem.',
    modulos: [
      { key: 'produtos', label: 'Produtos', description: 'Fotos, preços e em quais canais o produto aparece.' },
      { key: 'estoque', label: 'Estoque', description: 'Entradas, saídas e a contagem de cada item.' },
      { key: 'categorias', label: 'Categorias', description: 'Seções do cardápio e a ordem delas.' },
      { key: 'adicionais', label: 'Adicionais', description: 'Grupos de adicional e as opções de cada um.' },
      { key: 'ofertas', label: 'Ofertas e combos', description: 'Promoções, combos e a vitrine do cardápio.' },
    ],
  },
  {
    titulo: 'Pessoas',
    descricao: 'A base de clientes e o fiado da loja.',
    modulos: [
      { key: 'clientes', label: 'Clientes', description: 'Cadastro, telefone, endereço e histórico de compras.' },
      {
        key: 'prazo',
        label: 'Conta da Casa (fiado)',
        description: 'Extrato, saldo devedor e baixa de pagamento.',
        alerta: 'Alterar aqui mexe em dívida de cliente.',
      },
    ],
  },
  {
    titulo: 'Marketing',
    descricao: 'A conversa com o cliente pelo WhatsApp.',
    modulos: [
      { key: 'whatsapp', label: 'WhatsApp', description: 'Conexão do número, mensagens automáticas e histórico.' },
      {
        key: 'campanhas',
        label: 'Campanhas',
        description: 'Listas, disparos em massa e resultado de cada campanha.',
        alerta: 'Alterar aqui dispara mensagem para a base inteira.',
      },
    ],
  },
  {
    titulo: 'Operação',
    descricao: 'Encomendas e quem entrega.',
    modulos: [
      { key: 'encomendas', label: 'Encomendas', description: 'Agenda completa e a configuração do catálogo de encomenda.' },
      { key: 'entregas', label: 'Entregas e freelance', description: 'Equipe de entrega, diaristas e o que cada um recebeu.' },
    ],
  },
  {
    titulo: 'Configurações da loja',
    descricao: 'O que define como a loja funciona por fora.',
    modulos: [
      {
        key: 'perfil',
        label: 'Perfil da loja',
        description: 'Dados, taxas, horários, pagamentos, impressora e aparência.',
        alerta: 'Alterar aqui muda como a loja aparece e cobra no cardápio.',
      },
      {
        key: 'usuarios',
        label: 'Usuários e acesso',
        description: 'Criar funcionários, trocar senha e mudar permissões.',
        alerta: 'Quem altera aqui pode criar outros acessos.',
      },
    ],
  },
];

const RETAGUARDA_LABELS = new Map<RetaguardaPermissionKey, string>(
  RETAGUARDA_GROUPS.flatMap((grupo) => grupo.modulos.map((modulo) => [modulo.key, modulo.label])),
);

class UsuariosRequestError extends Error {}

function emptyForm(): UserFormState {
  return {
    uid: null,
    name: '',
    login: '',
    password: '',
    loginTocado: false,
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
    login: typeof source.login === 'string' && source.login
      ? source.login
      : typeof source.email === 'string' ? source.email : '',
    canReceiveEmail: source.canReceiveEmail === true,
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
  const hasRetaguardaModule = RETAGUARDA_PERMISSION_KEYS.some(
    (key) => permissions.retaguarda[key]?.ver === true,
  );
  return hasPdvTab || hasRetaguardaModule;
}

function formatCreatedAt(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(date);
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

/** Resumo legível das abas do PDV que o funcionário enxerga. */
function getPdvAccessLabels(permissions: OperatorPermissions): string[] {
  return PDV_TAB_OPTIONS.filter((tab) => permissions.pdv.tabs[tab.id] === true).map((tab) => tab.label);
}

/** Módulos do menu lateral que o funcionário enxerga. */
function getRetaguardaAccessLabels(permissions: OperatorPermissions): string[] {
  return RETAGUARDA_PERMISSION_KEYS
    .filter((key) => permissions.retaguarda[key]?.ver === true)
    .map((key) => RETAGUARDA_LABELS.get(key) || key);
}

/** Módulos em que ele não só entra: também altera. */
function getRetaguardaEditLabels(permissions: OperatorPermissions): string[] {
  return RETAGUARDA_PERMISSION_KEYS
    .filter((key) => permissions.retaguarda[key]?.editar === true)
    .map((key) => RETAGUARDA_LABELS.get(key) || key);
}

export function UsuariosTab({ user, db, adminSecret, isAdminSecretLoading }: UsuariosTabProps) {
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
  const [passwordTarget, setPasswordTarget] = useState<ManagedUser | null>(null);
  const [passwordValue, setPasswordValue] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [credenciais, setCredenciais] = useState<CredenciaisEntregues | null>(null);
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
  // Apelido não recebe e-mail, então a senha deixa de ser opcional no formulário.
  const loginEhApelido = resolveOperatorLogin(form.login)?.kind === 'handle';

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
      login: usuario.login,
      password: '',
      loginTocado: true,
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

  const updateRetaguardaPermission = (
    key: RetaguardaPermissionKey,
    campo: 'ver' | 'editar',
    checked: boolean,
  ) => {
    setForm((current) => {
      const atual = current.permissions.retaguarda[key];
      // Ligar "alterar" implica entrar na tela; desligar "ver" leva os dois.
      const proximo = campo === 'ver'
        ? { ver: checked, editar: checked ? atual.editar : false }
        : { ver: checked ? true : atual.ver, editar: checked };
      return {
        ...current,
        permissions: normalizeOperatorPermissions({
          ...current.permissions,
          retaguarda: { ...current.permissions.retaguarda, [key]: proximo },
        }),
      };
    });
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
    const loginDigitado = form.login.trim();
    const acesso = resolveOperatorLogin(loginDigitado);
    const senha = form.password;
    if (!name) {
      setFormError('Informe o nome do usuário.');
      return;
    }
    if (!form.uid && !acesso) {
      setFormError('Escolha como ele entra: um apelido curto (ex.: maria) ou o e-mail dele.');
      return;
    }
    // Apelido não tem caixa de entrada, então a senha nasce aqui. Com e-mail de
    // verdade, deixar a senha em branco ainda manda o convite do Firebase.
    if (!form.uid && (acesso?.kind === 'handle' || senha)) {
      const problemaSenha = validateOperatorPassword(senha);
      if (problemaSenha) {
        setFormError(problemaSenha);
        return;
      }
    }
    if (!hasUsableAccess(form.permissions)) {
      setFormError('Libere ao menos uma aba da Frente de Caixa ou um módulo da Retaguarda.');
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
          login: loginDigitado,
          ...(senha ? { password: senha } : {}),
          permissions: form.permissions,
        });
      const savedUser = coerceManagedUser(data.usuario);
      if (!savedUser) throw new UsuariosRequestError('A API retornou um usuário inválido.');
      upsertUser(savedUser);
      setDialogOpen(false);
      setForm(emptyForm());
      setShowPassword(false);
      // A senha só existe aqui, nesta tela: o servidor guarda o hash e nunca a
      // devolve. Por isso ela é mostrada uma vez, para o dono anotar e entregar.
      if (!form.uid && senha) {
        setCredenciais({ nome: savedUser.name, login: savedUser.login, password: senha });
      }
      toast({
        title: form.uid ? 'Usuário atualizado' : 'Usuário criado',
        description: 'warning' in data && typeof data.warning === 'string'
          ? data.warning
          : form.uid
            ? 'As permissões novas entram em vigor em tempo real.'
            : senha
              ? 'Entregue o usuário e a senha para ele entrar.'
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

  const abrirTrocaDeSenha = (usuario: ManagedUser) => {
    if (operationRef.current) return;
    setPasswordTarget(usuario);
    setPasswordValue('');
    setPasswordError('');
    setShowPassword(false);
  };

  const fecharTrocaDeSenha = () => {
    setPasswordTarget(null);
    setPasswordValue('');
    setPasswordError('');
    setShowPassword(false);
  };

  const handleChangePassword = async (event: FormEvent) => {
    event.preventDefault();
    const alvo = passwordTarget;
    if (!alvo || operationRef.current) return;
    const problema = validateOperatorPassword(passwordValue);
    if (problema) {
      setPasswordError(problema);
      return;
    }

    operationRef.current = true;
    setIsSavingPassword(true);
    setPasswordError('');
    try {
      await request('PATCH', { uid: alvo.uid, action: 'set_password', password: passwordValue });
      setCredenciais({ nome: alvo.name, login: alvo.login, password: passwordValue });
      fecharTrocaDeSenha();
      toast({
        title: 'Senha trocada',
        description: 'A senha antiga não vale mais. Entregue a nova para ' + (alvo.name || 'o funcionário') + '.',
      });
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : 'Não foi possível trocar a senha.');
    } finally {
      operationRef.current = false;
      setIsSavingPassword(false);
    }
  };

  const copiarCredenciais = async () => {
    if (!credenciais) return;
    const texto = 'Usuário: ' + credenciais.login + '\nSenha: ' + credenciais.password;
    try {
      await navigator.clipboard.writeText(texto);
      toast({ title: 'Copiado', description: 'Cole no WhatsApp do funcionário.' });
    } catch {
      toast({
        variant: 'destructive',
        title: 'Não foi possível copiar',
        description: 'Anote manualmente: ' + texto.replace('\n', ' / '),
      });
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
            ? 'O funcionário voltou a ter o acesso que você configurou.'
            : 'O funcionário perde o acesso na mesma hora, mesmo se estiver com o sistema aberto.',
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
        <AlertTitle>Cada funcionário vê só o que você liberar</AlertTitle>
        <AlertDescription>
          Tudo é escolha sua, tela por tela — inclusive faturamento e configurações. Desativar um funcionário bloqueia o acesso na hora, sem apagar o histórico.
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
                        <div className="flex min-w-0 items-center gap-3">
                          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${usuario.active ? 'bg-gradient-to-br from-emerald-500 to-emerald-700' : 'bg-slate-400'}`}>
                            {getInitials(usuario.name || '?')}
                          </div>
                          <div className="min-w-0">
                            <CardTitle className="truncate text-lg">{usuario.name || 'Sem nome'}</CardTitle>
                            <CardDescription className="truncate">{descreveLogin(usuario)}</CardDescription>
                          </div>
                        </div>
                        <Badge variant={usuario.active ? 'default' : 'secondary'} className={usuario.active ? 'bg-emerald-600' : ''}>
                          {usuario.active ? 'Ativo' : 'Inativo'}
                        </Badge>
                      </div>

                      {(() => {
                        const pdvLabels = getPdvAccessLabels(usuario.permissions);
                        const retLabels = getRetaguardaAccessLabels(usuario.permissions);
                        const editLabels = getRetaguardaEditLabels(usuario.permissions);
                        return (
                          <div className="space-y-2 rounded-lg bg-slate-50 p-3">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-xs font-medium text-slate-500">Frente de caixa:</span>
                              {pdvLabels.length > 0
                                ? pdvLabels.map((label) => (
                                    <Badge key={label} variant="secondary" className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">{label}</Badge>
                                  ))
                                : <span className="text-xs text-slate-400">nenhuma aba liberada</span>}
                            </div>
                            {retLabels.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-xs font-medium text-slate-500">Retaguarda:</span>
                                {retLabels.map((label) => (
                                  <Badge key={label} variant="outline">{label}</Badge>
                                ))}
                              </div>
                            )}
                            {editLabels.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-xs font-medium text-slate-500">Pode alterar:</span>
                                {editLabels.map((label) => (
                                  <Badge key={label} variant="secondary" className="bg-amber-100 text-amber-900 hover:bg-amber-100">{label}</Badge>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      <div className="flex flex-wrap items-center gap-2">
                        {usuario.authMissing && <Badge variant="destructive">Login não encontrado</Badge>}
                        {usuario.authDisabled && <Badge variant="destructive">Login bloqueado</Badge>}
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
                        onClick={() => abrirTrocaDeSenha(usuario)}
                        disabled={hasPendingAction || usuario.authMissing}
                      >
                        <KeyRound className="h-4 w-4" /> Trocar senha
                      </Button>
                      {/* Só quem entra por e-mail de verdade tem para onde receber o link. */}
                      {usuario.canReceiveEmail && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void handleResendInvite(usuario)}
                          disabled={hasPendingAction || usuario.authMissing}
                        >
                          {isBusy && busyAction?.action === 'invite' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                          Enviar link por e-mail
                        </Button>
                      )}
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

      <Separator className="my-1" />
      <AdminPasswordSection db={db} user={user} adminSecret={adminSecret} isLoading={isAdminSecretLoading} />

      <Dialog open={dialogOpen} onOpenChange={(open) => !isSaving && setDialogOpen(open)}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.uid ? 'Editar usuário' : 'Novo usuário'}</DialogTitle>
            <DialogDescription>
              {form.uid
                ? 'Altere o nome e o que ele pode acessar. O usuário de entrada continua o mesmo.'
                : 'Você escolhe como ele entra e qual é a senha. Sem e-mail no meio do caminho.'}
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
                    onChange={(event) => setForm((current) => ({
                      ...current,
                      name: event.target.value,
                      // Até o dono mexer no campo de usuário, ele segue o nome.
                      login: current.uid || current.loginTocado
                        ? current.login
                        : suggestOperatorHandle(event.target.value),
                    }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="operator-login">Usuário para entrar</Label>
                  <Input
                    id="operator-login"
                    value={form.login}
                    maxLength={254}
                    autoComplete="off"
                    readOnly={Boolean(form.uid)}
                    disabled={isSaving}
                    className={form.uid ? 'bg-slate-100' : ''}
                    onChange={(event) => setForm((current) => ({
                      ...current,
                      login: event.target.value,
                      loginTocado: true,
                    }))}
                  />
                  <p className="text-xs text-slate-500">
                    {form.uid
                      ? 'Para trocar o usuário, remova este acesso e crie outro.'
                      : 'Um apelido curto basta (ex.: maria). Se ele tiver e-mail, pode usar o e-mail.'}
                  </p>
                </div>
                {!form.uid && (
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="operator-password">Senha</Label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          id="operator-password"
                          type={showPassword ? 'text' : 'password'}
                          value={form.password}
                          maxLength={128}
                          autoComplete="new-password"
                          disabled={isSaving}
                          className="pr-10"
                          onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                        />
                        <button
                          type="button"
                          aria-label={showPassword ? 'Esconder senha' : 'Mostrar senha'}
                          onClick={() => setShowPassword((atual) => !atual)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-600"
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={isSaving}
                        onClick={() => {
                          setForm((current) => ({ ...current, password: generateOperatorPassword() }));
                          setShowPassword(true);
                        }}
                      >
                        <RefreshCw className="h-4 w-4" /> Sortear
                      </Button>
                    </div>
                    <p className="text-xs text-slate-500">
                      {loginEhApelido
                        ? 'Quem entra por apelido não recebe e-mail: a senha é esta que você escolher aqui.'
                        : 'Deixe em branco para ele criar a própria senha pelo link que chega no e-mail.'}
                    </p>
                  </div>
                )}
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
                Duas decisões por tela: <strong>Ver</strong> abre o módulo para ele; <strong>Alterar</strong> deixa mexer no que está lá.
              </p>
            </div>

            {RETAGUARDA_GROUPS.map((grupo) => (
              <Card key={grupo.titulo}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{grupo.titulo}</CardTitle>
                  <CardDescription>{grupo.descricao}</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2">
                  {grupo.modulos.map((modulo) => {
                    const valor = form.permissions.retaguarda[modulo.key];
                    const somenteLeitura = RETAGUARDA_SOMENTE_LEITURA.has(modulo.key);
                    return (
                      <div
                        key={modulo.key}
                        className={`flex items-start justify-between gap-4 rounded-lg border p-3 ${valor.editar && modulo.alerta ? 'border-amber-200 bg-amber-50/60' : 'bg-slate-50'}`}
                      >
                        <div className="min-w-0 text-sm">
                          <p className="font-medium">{modulo.label}</p>
                          <p className="mt-1 text-xs text-slate-500">{modulo.description}</p>
                          {modulo.alerta && valor.editar && (
                            <p className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-700">
                              <LockKeyhole className="h-3 w-3" /> {modulo.alerta}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-start gap-4">
                          <div className="flex flex-col items-center gap-1">
                            <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Ver</span>
                            <Switch
                              aria-label={'Ver ' + modulo.label}
                              checked={valor.ver}
                              disabled={isSaving}
                              onCheckedChange={(checked) => updateRetaguardaPermission(modulo.key, 'ver', checked)}
                            />
                          </div>
                          {!somenteLeitura && (
                            <div className="flex flex-col items-center gap-1">
                              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Alterar</span>
                              <Switch
                                aria-label={'Alterar ' + modulo.label}
                                checked={valor.editar}
                                disabled={isSaving || !valor.ver}
                                onCheckedChange={(checked) => updateRetaguardaPermission(modulo.key, 'editar', checked)}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            ))}

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
                {isSaving ? 'Salvando…' : form.uid ? 'Salvar alterações' : 'Criar acesso'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(passwordTarget)}
        onOpenChange={(open) => { if (!open && !isSavingPassword) fecharTrocaDeSenha(); }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Trocar a senha de {passwordTarget?.name || 'funcionário'}</DialogTitle>
            <DialogDescription>
              A senha antiga deixa de valer na hora. Se ele estiver com o sistema aberto, cai para a tela de login.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="operator-new-password">Senha nova</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="operator-new-password"
                    type={showPassword ? 'text' : 'password'}
                    value={passwordValue}
                    maxLength={128}
                    autoComplete="new-password"
                    disabled={isSavingPassword}
                    className="pr-10"
                    onChange={(event) => { setPasswordValue(event.target.value); setPasswordError(''); }}
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? 'Esconder senha' : 'Mostrar senha'}
                    onClick={() => setShowPassword((atual) => !atual)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSavingPassword}
                  onClick={() => { setPasswordValue(generateOperatorPassword()); setShowPassword(true); setPasswordError(''); }}
                >
                  <RefreshCw className="h-4 w-4" /> Sortear
                </Button>
              </div>
            </div>

            {passwordError && (
              <Alert variant="destructive">
                <CircleAlert className="h-4 w-4" />
                <AlertDescription>{passwordError}</AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" disabled={isSavingPassword} onClick={fecharTrocaDeSenha}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isSavingPassword}>
                {isSavingPassword ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                {isSavingPassword ? 'Trocando…' : 'Trocar senha'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(credenciais)} onOpenChange={(open) => !open && setCredenciais(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Acesso de {credenciais?.nome || 'funcionário'}</DialogTitle>
            <DialogDescription>
              Anote ou copie agora: por segurança, a senha não aparece de novo. Se perder, é só trocar por outra.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-lg border bg-slate-50 p-3">
              <p className="text-xs font-medium text-slate-500">Usuário</p>
              <p className="break-all font-mono text-lg font-bold text-slate-800">{credenciais?.login}</p>
            </div>
            <div className="rounded-lg border bg-slate-50 p-3">
              <p className="text-xs font-medium text-slate-500">Senha</p>
              <p className="break-all font-mono text-lg font-bold text-slate-800">{credenciais?.password}</p>
            </div>
            <Button type="button" variant="outline" className="w-full" onClick={() => void copiarCredenciais()}>
              <Copy className="h-4 w-4" /> Copiar usuário e senha
            </Button>
          </div>

          <DialogFooter>
            <Button type="button" onClick={() => setCredenciais(null)}>Pronto, anotei</Button>
          </DialogFooter>
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
                ? 'O login será apagado e não poderá ser recuperado. Os pedidos e o histórico da loja continuam salvos.'
                : confirmation?.usuario.active
                  ? 'O funcionário perde o acesso na hora, mesmo se estiver com o sistema aberto.'
                  : 'O funcionário volta a ver só as abas e módulos que você deixou marcados.'}
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
