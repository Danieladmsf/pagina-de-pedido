'use client';

import React, { useState } from 'react';
import { useAuth, useFirestore } from '@/firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import {
  Star,
  Store,
  Mail,
  Lock,
  Loader2,
  Eye,
  EyeOff,
  ArrowRight,
  ArrowLeft,
  ShoppingBag,
  Bike,
  UtensilsCrossed,
  Wallet,
} from 'lucide-react';

const HIGHLIGHTS = [
  { Icon: ShoppingBag, label: 'Cardápio digital com link próprio' },
  { Icon: Bike, label: 'Delivery com cálculo de taxa por raio' },
  { Icon: UtensilsCrossed, label: 'Mesas e comandas integradas' },
  { Icon: Wallet, label: 'Caixa e dashboard em tempo real' },
];

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [storeName, setStoreName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const auth = useAuth();
  const db = useFirestore();
  const router = useRouter();
  const { toast } = useToast();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.push('/admin');
      toast({ title: 'Bem-vindo!', description: 'Login realizado com sucesso.' });
    } catch (error: any) {
      let msg = 'E-mail ou senha inválidos.';
      if (error?.code === 'auth/user-not-found') msg = 'Usuário não encontrado. Cadastre-se primeiro.';
      if (error?.code === 'auth/wrong-password') msg = 'Senha incorreta.';
      if (error?.code === 'auth/invalid-credential') msg = 'E-mail ou senha inválidos.';
      if (error?.code === 'auth/too-many-requests') msg = 'Muitas tentativas. Tente novamente em alguns minutos.';
      if (error?.code === 'auth/network-request-failed') msg = 'Sem conexão. Verifique sua internet.';
      toast({ variant: 'destructive', title: 'Erro no login', description: msg });
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast({ variant: 'destructive', title: 'Senha fraca', description: 'A senha deve ter pelo menos 6 caracteres.' });
      return;
    }
    if (!storeName.trim()) {
      toast({ variant: 'destructive', title: 'Nome obrigatório', description: 'Informe o nome da sua loja.' });
      return;
    }
    setLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: storeName.trim() });

      if (db) {
        await setDoc(doc(db, 'roles_admin', cred.user.uid), {
          storeName: storeName.trim(),
          email: email,
          createdAt: new Date().toISOString(),
        });
      }

      toast({ title: 'Conta criada!', description: 'Bem-vindo ao seu painel administrativo.' });
      router.push('/admin');
    } catch (error: any) {
      let msg = 'Não foi possível criar a conta.';
      if (error?.code === 'auth/email-already-in-use') msg = 'Este e-mail já está cadastrado. Faça login.';
      if (error?.code === 'auth/weak-password') msg = 'A senha deve ter pelo menos 6 caracteres.';
      if (error?.code === 'auth/invalid-email') msg = 'E-mail inválido.';
      if (error?.code === 'auth/network-request-failed') msg = 'Sem conexão. Verifique sua internet.';
      toast({ variant: 'destructive', title: 'Erro no cadastro', description: msg });
    } finally {
      setLoading(false);
    }
  };

  const isLogin = mode === 'login';

  return (
    <div className="min-h-screen bg-black text-white antialiased relative overflow-hidden">
      {/* Background glows */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute -top-40 -right-40 h-[500px] w-[500px] rounded-full bg-emerald-500/10 blur-[120px]" />
        <div className="absolute top-1/2 -left-40 h-[400px] w-[400px] rounded-full bg-cyan-500/10 blur-[120px]" />
        <div className="absolute bottom-0 right-1/3 h-[300px] w-[300px] rounded-full bg-violet-500/10 blur-[120px]" />
      </div>

      <div className="relative z-10 min-h-screen grid lg:grid-cols-2">
        {/* Coluna esquerda - Brand */}
        <div className="hidden lg:flex flex-col justify-between p-12 border-r border-white/5">
          <a href="/polaris" className="flex items-center gap-2 group w-fit">
            <ArrowLeft className="h-4 w-4 text-slate-400 group-hover:-translate-x-1 transition-transform" />
            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center shadow-lg shadow-emerald-500/30">
              <Star className="h-5 w-5 text-black fill-black" />
            </div>
            <span className="text-lg font-black tracking-tight">
              POLARIS<span className="text-emerald-400"> PDV</span>
            </span>
          </a>

          <div className="space-y-8">
            <h1 className="text-5xl font-black tracking-tighter leading-[0.95]">
              Bom te ver
              <br />
              <span className="bg-gradient-to-r from-emerald-400 via-cyan-400 to-blue-400 bg-clip-text text-transparent">
                de volta.
              </span>
            </h1>
            <p className="text-slate-400 text-lg max-w-md leading-relaxed">
              Acesse o painel e continue de onde parou.
            </p>

            <ul className="space-y-3 pt-4">
              {HIGHLIGHTS.map((h) => {
                const Icon = h.Icon;
                return (
                  <li key={h.label} className="flex items-center gap-3 text-sm text-slate-300">
                    <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 border border-emerald-500/20 flex items-center justify-center shrink-0">
                      <Icon className="h-4 w-4 text-emerald-400" />
                    </div>
                    {h.label}
                  </li>
                );
              })}
            </ul>
          </div>

          <p className="text-xs text-slate-600">
            POLARIS PDV — uma plataforma de gestão para restaurantes.
          </p>
        </div>

        {/* Coluna direita - Form */}
        <div className="flex flex-col justify-center p-6 md:p-12">
          {/* Mobile header */}
          <div className="lg:hidden mb-8">
            <a href="/polaris" className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center shadow-lg shadow-emerald-500/30">
                <Star className="h-5 w-5 text-black fill-black" />
              </div>
              <span className="text-lg font-black tracking-tight">
                POLARIS<span className="text-emerald-400"> PDV</span>
              </span>
            </a>
          </div>

          <div className="w-full max-w-md mx-auto">
            {/* Tabs */}
            <div className="flex gap-1 p-1 bg-white/5 rounded-xl border border-white/10 mb-8">
              <button
                onClick={() => setMode('login')}
                className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${
                  isLogin
                    ? 'bg-gradient-to-r from-emerald-500 to-cyan-500 text-black shadow-lg shadow-emerald-500/30'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Entrar
              </button>
              <button
                onClick={() => setMode('register')}
                className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${
                  !isLogin
                    ? 'bg-gradient-to-r from-emerald-500 to-cyan-500 text-black shadow-lg shadow-emerald-500/30'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Criar conta
              </button>
            </div>

            <div className="mb-8">
              <h2 className="text-3xl font-black tracking-tight mb-2">
                {isLogin ? 'Acessar painel' : 'Criar conta'}
              </h2>
              <p className="text-sm text-slate-400">
                {isLogin
                  ? 'Entre com suas credenciais de administrador.'
                  : 'Cadastre-se para gerenciar sua loja.'}
              </p>
            </div>

            <form onSubmit={isLogin ? handleLogin : handleRegister} className="space-y-5">
              {!isLogin && (
                <div className="space-y-2">
                  <label htmlFor="storeName" className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Nome da loja
                  </label>
                  <div className="relative">
                    <Store className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                    <input
                      id="storeName"
                      type="text"
                      placeholder="Ex: Pizzaria do João"
                      value={storeName}
                      onChange={(e) => setStoreName(e.target.value)}
                      required
                      className="w-full h-12 pl-10 pr-4 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/60 focus:bg-white/[0.07] focus:ring-2 focus:ring-emerald-500/20 transition-all"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <label htmlFor="email" className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  E-mail
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                  <input
                    id="email"
                    type="email"
                    placeholder="seu@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    className="w-full h-12 pl-10 pr-4 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/60 focus:bg-white/[0.07] focus:ring-2 focus:ring-emerald-500/20 transition-all"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Senha
                  </label>
                  {isLogin && (
                    <a href="#" className="text-xs text-slate-500 hover:text-emerald-400 transition-colors">
                      Esqueceu?
                    </a>
                  )}
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder={isLogin ? '' : 'Mínimo 6 caracteres'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete={isLogin ? 'current-password' : 'new-password'}
                    className="w-full h-12 pl-10 pr-12 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/60 focus:bg-white/[0.07] focus:ring-2 focus:ring-emerald-500/20 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="group w-full h-12 bg-gradient-to-r from-emerald-500 to-cyan-500 text-black font-bold rounded-xl hover:from-emerald-400 hover:to-cyan-400 transition-all shadow-lg shadow-emerald-500/30 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {isLogin ? 'Entrando...' : 'Criando sua loja...'}
                  </>
                ) : (
                  <>
                    {isLogin ? 'Entrar no painel' : 'Criar minha conta'}
                    <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
