import { put } from '@vercel/blob';
import { NextResponse } from 'next/server';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const filename = searchParams.get('filename');

    if (!filename) {
      return NextResponse.json({ error: 'filename é obrigatório' }, { status: 400 });
    }

    if (!request.body) {
      return NextResponse.json({ error: 'Arquivo não enviado' }, { status: 400 });
    }

    const token = process.env.BLOB_PUBLIC_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      return NextResponse.json({
        error: 'Vercel Blob não configurado. Conecte o Blob Store ao projeto em Vercel > Storage.'
      }, { status: 500 });
    }

    const blob = await put(filename, request.body, {
      access: 'public',
      addRandomSuffix: true,
      token,
    });

    return NextResponse.json(blob);
  } catch (error: any) {
    console.error('Upload error:', error);
    return NextResponse.json({
      error: error?.message || 'Erro ao fazer upload da imagem'
    }, { status: 500 });
  }
}
