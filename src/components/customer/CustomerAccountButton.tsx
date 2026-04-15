
"use client"

import React, { useEffect, useMemo, useState } from 'react';
import { useUser, useAuth, useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import Link from 'next/link';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { LogIn, LogOut, UserIcon, ShoppingBag, Loader2, Bell } from 'lucide-react';

export function CustomerAccountButton() {
  const { user } = useUser();
  const auth = useAuth();
  const db = useFirestore();
  const { toast } = useToast();
  const isRealUser = !!(user && !user.isAnonymous && user.email);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const myOrdersQuery = useMemoFirebase(() => {
    if (!db || !isRealUser) return null;
    return query(collection(db, 'orders'), where('customerIdentifier', '==', user!.uid));
  }, [db, isRealUser]);
  const { data: myOrders } = useCollection(myOrdersQuery);

  // Badge de pedidos em andamento (não concluídos nem pendentes novos)
  const activeCount = useMemo(() => {
    if (!myOrders) return 0;
    return (myOrders as any[]).filter(o => ['received', 'ready', 'out_for_delivery'].includes(o.status)).length;
  }, [myOrders]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth) return;
    if (!email || password.length < 6) {
      toast({ variant: 'destructive', title: 'Dados inválidos', description: 'Email e senha (6+ caracteres).' });
      return;
    }
    setLoading(true);
    try {
      try {
        await signInWithEmailAndPassword(auth, email, password);
      } catch (err: any) {
        if (err?.code === 'auth/user-not-found' || err?.code === 'auth/invalid-credential') {
          await createUserWithEmailAndPassword(auth, email, password);
        } else {
          throw err;
        }
      }
      toast({ title: 'Bem-vindo!', description: 'Login realizado com sucesso.' });
      setOpen(false);
      setPassword('');
    } catch (err: any) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Erro', description: err?.message || 'Falha na autenticação.' });
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    if (!auth) return;
    try {
      await signOut(auth);
      toast({ title: 'Sessão encerrada' });
    } catch {}
  };

  if (isRealUser) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm" className="bg-white/90 backdrop-blur text-primary font-bold shadow-md relative">
            <UserIcon className="h-4 w-4 mr-2" /> {user!.email?.split('@')[0]}
            {activeCount > 0 && (
              <Badge className="absolute -top-2 -right-2 bg-accent text-white h-5 min-w-[20px] px-1 flex items-center justify-center text-[10px] font-bold border-2 border-white">
                {activeCount}
              </Badge>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">Logado como</span>
              <span className="font-bold truncate">{user!.email}</span>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <Link href="/my-orders">
            <DropdownMenuItem className="cursor-pointer">
              <ShoppingBag className="h-4 w-4 mr-2" /> Meus Pedidos
              {activeCount > 0 && (
                <Badge className="ml-auto bg-accent text-white text-[10px]">{activeCount} em andamento</Badge>
              )}
            </DropdownMenuItem>
          </Link>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="cursor-pointer text-destructive" onClick={handleLogout}>
            <LogOut className="h-4 w-4 mr-2" /> Sair
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        variant="secondary"
        size="sm"
        className="bg-white/90 backdrop-blur text-primary font-bold shadow-md"
      >
        <LogIn className="h-4 w-4 mr-2" /> Entrar
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Entrar ou Cadastrar</DialogTitle>
            <DialogDescription>
              Use seu email e senha. Se for novo, criamos sua conta automaticamente.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAuth} className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="login_email">Email</Label>
              <Input id="login_email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="login_pass">Senha (mínimo 6 caracteres)</Label>
              <Input id="login_pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
            </div>
            <Button type="submit" className="w-full h-11 font-bold" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <LogIn className="h-4 w-4 mr-2" />}
              Entrar / Cadastrar
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
