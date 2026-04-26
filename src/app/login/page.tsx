
'use client';

import React, { useState } from 'react';
import { useAuth, useFirestore } from '@/firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Lock, Mail, Loader2, UserPlus, LogIn, Store } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [storeName, setStoreName] = useState('');
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
      toast({ title: "Bem-vindo!", description: "Login realizado com sucesso." });
    } catch (error: any) {
      let msg = "E-mail ou senha inválidos.";
      if (error?.code === 'auth/user-not-found') msg = "Usuário não encontrado. Cadastre-se primeiro.";
      if (error?.code === 'auth/wrong-password') msg = "Senha incorreta.";
      if (error?.code === 'auth/invalid-credential') msg = "E-mail ou senha inválidos.";
      toast({ variant: "destructive", title: "Erro no login", description: msg });
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast({ variant: "destructive", title: "Senha fraca", description: "A senha deve ter pelo menos 6 caracteres." });
      return;
    }
    if (!storeName.trim()) {
      toast({ variant: "destructive", title: "Nome obrigatório", description: "Informe o nome da sua loja." });
      return;
    }
    setLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      
      // Atualiza o nome do perfil
      await updateProfile(cred.user, { displayName: storeName.trim() });
      
      // Cria o registro de admin no Firestore
      if (db) {
        await setDoc(doc(db, 'roles_admin', cred.user.uid), {
          storeName: storeName.trim(),
          email: email,
          createdAt: new Date().toISOString(),
        });
      }

      toast({ title: "Conta criada!", description: "Bem-vindo ao seu painel administrativo." });
      router.push('/admin');
    } catch (error: any) {
      let msg = "Não foi possível criar a conta.";
      if (error?.code === 'auth/email-already-in-use') msg = "Este e-mail já está cadastrado. Faça login.";
      if (error?.code === 'auth/weak-password') msg = "A senha deve ter pelo menos 6 caracteres.";
      if (error?.code === 'auth/invalid-email') msg = "E-mail inválido.";
      toast({ variant: "destructive", title: "Erro no cadastro", description: msg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md shadow-xl border-none">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto bg-primary/10 p-3 rounded-full w-fit mb-2">
            {mode === 'login' ? <Lock className="h-6 w-6 text-primary" /> : <UserPlus className="h-6 w-6 text-primary" />}
          </div>
          <CardTitle className="text-2xl font-bold">
            {mode === 'login' ? 'Acesso Restrito' : 'Criar Conta'}
          </CardTitle>
          <CardDescription>
            {mode === 'login' 
              ? 'Entre com suas credenciais de administrador.' 
              : 'Cadastre-se para gerenciar sua loja.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={mode === 'login' ? handleLogin : handleRegister} className="space-y-4">
            
            {mode === 'register' && (
              <div className="space-y-2">
                <Label htmlFor="storeName">Nome da Loja</Label>
                <div className="relative">
                  <Store className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input 
                    id="storeName" 
                    type="text" 
                    placeholder="Ex: Restaurante Sabor & Arte" 
                    className="pl-10"
                    value={storeName}
                    onChange={(e) => setStoreName(e.target.value)}
                    required 
                  />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input 
                  id="email" 
                  type="email" 
                  placeholder="seu@email.com" 
                  className="pl-10"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required 
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input 
                  id="password" 
                  type="password" 
                  placeholder={mode === 'register' ? 'Mínimo 6 caracteres' : ''}
                  className="pl-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required 
                />
              </div>
            </div>

            <Button type="submit" className="w-full h-11 font-bold" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {mode === 'login' ? (
                <><LogIn className="h-4 w-4 mr-2" /> Entrar no Painel</>
              ) : (
                <><UserPlus className="h-4 w-4 mr-2" /> Cadastrar e Entrar</>
              )}
            </Button>

            <div className="relative my-2">
              <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white px-2 text-muted-foreground">ou</span>
              </div>
            </div>

            <Button 
              type="button" 
              variant="outline" 
              className="w-full font-semibold"
              onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
            >
              {mode === 'login' ? 'Não tem conta? Cadastre-se' : 'Já tem conta? Fazer Login'}
            </Button>

            <Button 
              type="button" 
              variant="ghost" 
              className="w-full"
              onClick={() => router.push('/')}
            >
              Voltar ao Cardápio
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
