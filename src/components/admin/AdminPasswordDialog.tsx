'use client';

import { useEffect, useRef, useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { type AdminSecret, verifyAdminPassword } from '@/lib/admin-password';

interface AdminPasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  secret: AdminSecret;
  title?: string;
  description?: string;
  submitLabel?: string;
  canCancel?: boolean;
  onSuccess: () => void;
}

export function AdminPasswordDialog({
  open,
  onOpenChange,
  secret,
  title = 'Senha do administrador',
  description = 'Digite a senha para continuar.',
  submitLabel = 'Desbloquear',
  canCancel = true,
  onSuccess,
}: AdminPasswordDialogProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const attemptRef = useRef(0);
  const openRef = useRef(open);
  const onSuccessRef = useRef(onSuccess);
  const latestSecretRef = useRef(secret);
  openRef.current = open;
  onSuccessRef.current = onSuccess;
  latestSecretRef.current = secret;

  useEffect(() => {
    attemptRef.current += 1;
    if (open) {
      setPassword('');
      setError('');
      setIsChecking(false);
    }
  }, [open, secret.passwordHash, secret.salt]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!password || isChecking) return;

    const attempt = ++attemptRef.current;
    setIsChecking(true);
    setError('');
    try {
      const isValid = await verifyAdminPassword(password, secret);
      if (attempt !== attemptRef.current || !openRef.current) return;
      const latestSecret = latestSecretRef.current;
      if (
        latestSecret.salt !== secret.salt
        || latestSecret.passwordHash !== secret.passwordHash
        || (latestSecret.version ?? 1) !== (secret.version ?? 1)
      ) {
        setError('A senha foi alterada em outra sessão. Digite a senha atual.');
        return;
      }
      if (!isValid) {
        setError('Senha incorreta. Tente novamente.');
        return;
      }
      setPassword('');
      onSuccessRef.current();
    } catch (verificationError) {
      if (attempt !== attemptRef.current) return;
      setError(verificationError instanceof Error
        ? verificationError.message
        : 'Não foi possível verificar a senha neste navegador.');
    } finally {
      if (attempt === attemptRef.current) setIsChecking(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen || (canCancel && !isChecking)) onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        onEscapeKeyDown={(event) => {
          if (!canCancel || isChecking) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (!canCancel || isChecking) event.preventDefault();
        }}
      >
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-emerald-600" />
              {title}
            </DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-5">
            <Label htmlFor="admin-password">Senha</Label>
            <Input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                if (error) setError('');
              }}
              aria-invalid={!!error}
            />
            {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          </div>

          <DialogFooter>
            {canCancel && (
              <Button type="button" variant="outline" disabled={isChecking} onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
            )}
            <Button type="submit" disabled={!password || isChecking}>
              {isChecking && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
