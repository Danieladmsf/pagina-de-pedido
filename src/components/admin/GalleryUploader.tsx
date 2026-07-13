'use client';

import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import Image from 'next/image';
import { Upload, X } from 'lucide-react';
import { uploadImage } from '@/lib/upload';

type Item = { key: string; url?: string; file?: File; preview: string };

export interface GalleryUploaderHandle {
  /** Sobe os arquivos pendentes e devolve as URLs finais, na ordem exibida. */
  getUrls: () => Promise<string[]>;
}

interface GalleryUploaderProps {
  /** URLs já salvas (fotos extras, sem a capa). */
  initialUrls?: string[];
  /** Muda quando o item editado troca — dispara o reset da galeria. */
  resetKey?: string;
  label?: string;
}

/**
 * Gerencia as fotos EXTRAS (além da capa) de um produto/combo. O pai chama
 * `getUrls()` no submit para subir os arquivos pendentes e receber o array
 * final. A capa continua sendo tratada separadamente pelo modal.
 */
export const GalleryUploader = forwardRef<GalleryUploaderHandle, GalleryUploaderProps>(
  ({ initialUrls = [], resetKey = '', label = 'Galeria (fotos extras)' }, ref) => {
    const [items, setItems] = useState<Item[]>([]);

    // Reinicia quando o item editado muda (não a cada render, senão faz loop).
    useEffect(() => {
      setItems(initialUrls.map((u, i) => ({ key: `init-${i}-${u}`, url: u, preview: u })));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resetKey]);

    useImperativeHandle(
      ref,
      () => ({
        getUrls: async () => {
          const results: string[] = [];
          for (const it of items) {
            if (it.url) results.push(it.url);
            else if (it.file) results.push(await uploadImage(it.file));
          }
          return results;
        },
      }),
      [items]
    );

    const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;
      setItems((prev) => [
        ...prev,
        ...files.map((f, i) => ({
          key: `new-${Date.now()}-${i}`,
          file: f,
          preview: URL.createObjectURL(f),
        })),
      ]);
      e.target.value = '';
    };

    const removeAt = (key: string) => setItems((prev) => prev.filter((it) => it.key !== key));

    return (
      <div className="space-y-1.5">
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</label>
        <div className="flex flex-wrap gap-2">
          {items.map((it) => (
            <div key={it.key} className="relative h-16 w-16 flex-shrink-0">
              <div className="relative h-16 w-16 overflow-hidden rounded-lg border">
                <Image src={it.preview} alt="foto" fill className="object-cover" />
              </div>
              <button
                type="button"
                onClick={() => removeAt(it.key)}
                title="Remover foto"
                aria-label="Remover foto"
                className="absolute -right-1.5 -top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-white bg-red-500 text-white shadow hover:bg-red-600"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          <label className="flex h-16 w-16 flex-shrink-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-muted-foreground/30 bg-muted/10 transition-colors hover:border-primary">
            <Upload className="h-4 w-4 text-muted-foreground" />
            <span className="text-[9px] font-medium text-muted-foreground">Adicionar</span>
            <input type="file" accept="image/*" multiple className="hidden" onChange={handlePick} />
          </label>
        </div>
      </div>
    );
  }
);

GalleryUploader.displayName = 'GalleryUploader';
