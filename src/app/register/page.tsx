'use client';

import React, { useState } from 'react';
import { useAuth, useFirestore } from '@/firebase';
import { createUserWithEmailAndPassword } from 'firebase/auth';
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
  Check,
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

function passwordStrength(p: string) {
  if (!p) return { score: 0, label: '', color: '' };
  let score = 0;
  if (p.length >= 6) score++;
  if (p.length >= 10) score++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) score++;
  if (/\d/.test(p)) score++;
  if (/[^A-Za-z0-9]/.test(p)) score++;
  const map = [
    { label: '', color: 'bg-slate-700' },
    { label: 'Fraca', color: 'bg-rose-500' },
    { label: 'Razoável', color: 'bg-amber-500' },
    { label: 'Boa', color: 'bg-emerald-500' },
    { label: 'Forte', color: 'bg-emerald-400' },
    { label: 'Muito forte', color: 'bg-cyan-400' },
  ];
  return { score, ...map[score] };
}

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [storeName, setStoreName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const auth = useAuth();
  const db = useFirestore();
  const router = useRouter();
  const { toast } = useToast();

  const strength = passwordStrength(password);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (!auth || !db) {
        toast({ variant: 'destructive', title: 'Erro no cadastro', description: 'Firebase ainda nao foi inicializado.' });
        return;
      }

      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      await setDoc(doc(db, 'roles_admin', user.uid), {
        uid: user.uid,
        email: user.email,
        storeName: storeName,
        createdAt: new Date().toISOString(),
      });

      const catId = Math.random().toString(36).substring(7);
      await setDoc(doc(db, 'categories', catId), {
        id: catId,
        name: 'Geral',
        ownerId: user.uid,
        displayOrder: 0,
        description: 'Categoria inicial',
      });

      let whatsappCreated = false;
      let whatsappWarning = '';
      try {
        const idToken = await user.getIdToken();
        const response = await fetch('/wapi/create-instance', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            empresaId: user.uid,
            instanceName: storeName.trim(),
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data?.error) {
          throw new Error(data?.error || 'Nao foi possivel criar a instancia WhatsApp.');
        }
        whatsappCreated = Boolean(data?.integration);
      } catch (wapiError: any) {
        console.warn('[W-API] Falha ao criar instancia inicial:', wapiError);
        whatsappWarning = wapiError?.message || 'Conecte o WhatsApp pelo painel depois.';
      }

      toast({
        title: 'Conta criada!',
        description: whatsappCreated
          ? 'Sua loja foi configurada. Abra a aba WhatsApp para escanear o QR Code.'
          : `Sua loja foi configurada. WhatsApp: ${whatsappWarning}`,
      });
      router.push('/');
    } catch (error: any) {
      let msg = error.message || 'Não foi possível criar sua conta.';
      if (error?.code === 'auth/email-already-in-use') msg = 'Este e-mail já está cadastrado.';
      if (error?.code === 'auth/invalid-email') msg = 'E-mail inválido.';
      if (error?.code === 'auth/weak-password') msg = 'A senha deve ter pelo menos 6 caracteres.';
      if (error?.code === 'auth/network-request-failed') msg = 'Sem conexão. Verifique sua internet.';
      toast({ variant: 'destructive', title: 'Erro no cadastro', description: msg });
    } finally {
      setLoading(false);
    }
  };

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
          <a href="/polaris" className="flex items-center gap-2 group">
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
              Bem-vindo
              <br />
              <span className="bg-gradient-to-r from-emerald-400 via-cyan-400 to-blue-400 bg-clip-text text-transparent">
                ao seu painel.
              </span>
            </h1>
            <p className="text-slate-400 text-lg max-w-md leading-relaxed">
              Crie sua conta e comece a configurar sua loja. Leva menos de 2 minutos.
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
            <div className="mb-8">
              <h2 className="text-3xl font-black tracking-tight mb-2">Criar conta</h2>
              <p className="text-sm text-slate-400">
                Já tem uma conta?{' '}
                <a href="/login" className="text-emerald-400 hover:text-emerald-300 font-semibold">
                  Entrar
                </a>
              </p>
            </div>

            <form onSubmit={handleRegister} className="space-y-5">
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

              <div className="space-y-2">
                <label htmlFor="email" className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  E-mail
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                  <input
                    id="email"
                    type="email"
                    placeholder="contato@sualoja.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full h-12 pl-10 pr-4 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/60 focus:bg-white/[0.07] focus:ring-2 focus:ring-emerald-500/20 transition-all"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Senha
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Mínimo 6 caracteres"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
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

                {password && (
                  <div className="flex items-center gap-2 pt-1">
                    <div className="flex-1 grid grid-cols-5 gap-1">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <div
                          key={i}
                          className={`h-1 rounded-full transition-colors ${
                            i <= strength.score ? strength.color : 'bg-white/5'
                          }`}
                        />
                      ))}
                    </div>
                    <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400 min-w-[80px] text-right">
                      {strength.label}
                    </span>
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={loading || password.length < 6 || !storeName.trim() || !email.trim()}
                className="group w-full h-12 bg-gradient-to-r from-emerald-500 to-cyan-500 text-black font-bold rounded-xl hover:from-emerald-400 hover:to-cyan-400 transition-all shadow-lg shadow-emerald-500/30 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Criando sua loja...
                  </>
                ) : (
                  <>
                    Criar minha conta
                    <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </button>

              <div className="pt-2 text-xs text-slate-500 leading-relaxed">
                Ao criar uma conta, você concorda com os{' '}
                <a href="#" className="text-slate-400 hover:text-white underline underline-offset-2">termos de uso</a>{' '}
                e a{' '}
                <a href="#" className="text-slate-400 hover:text-white underline underline-offset-2">política de privacidade</a>.
              </div>
            </form>

            <div className="mt-10 pt-6 border-t border-white/5">
              <p className="text-xs text-slate-500 mb-3">O que você ganha ao criar conta:</p>
              <ul className="space-y-2">
                {[
                  'Painel admin completo',
                  'Cardápio digital com link próprio',
                  'Importação inicial gratuita por CSV',
                ].map((b) => (
                  <li key={b} className="flex items-center gap-2 text-xs text-slate-400">
                    <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    {b}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
