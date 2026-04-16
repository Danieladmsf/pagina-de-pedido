'use client';

import React, { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';

function formatBRL(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

function toCents(value: string): number {
  return parseInt(value.replace(/\D/g, '') || '0', 10);
}

interface CurrencyInputProps {
  value?: number;
  defaultValue?: number;
  onChange?: (value: number) => void;
  id?: string;
  name?: string;
  className?: string;
  required?: boolean;
  placeholder?: string;
}

export function CurrencyInput({ value, defaultValue, onChange, id, name, className, required, placeholder }: CurrencyInputProps) {
  const [display, setDisplay] = useState(() => {
    const initial = value ?? defaultValue ?? 0;
    return formatBRL(Math.round(initial * 100));
  });

  useEffect(() => {
    if (value !== undefined) {
      setDisplay(formatBRL(Math.round(value * 100)));
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const cents = toCents(e.target.value);
    const formatted = formatBRL(cents);
    setDisplay(formatted);
    onChange?.(cents / 100);
  };

  return (
    <>
      <Input
        type="text"
        inputMode="numeric"
        id={id}
        value={display}
        onChange={handleChange}
        className={className}
        required={required}
        placeholder={placeholder || '0,00'}
      />
      {name && <input type="hidden" name={name} value={(toCents(display) / 100).toFixed(2)} />}
    </>
  );
}
