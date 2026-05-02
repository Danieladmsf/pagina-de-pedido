'use client';

import React, { useState } from 'react';
import { Camera, Loader2 } from 'lucide-react';

export default function ScreenshotButton() {
  const [isCapturing, setIsCapturing] = useState(false);

  const handleCapture = async () => {
    try {
      setIsCapturing(true);
      
      const elementToCapture = document.querySelector('main') || document.body;
      
      // Salvar os estilos originais para restaurar depois
      const originalStyle = elementToCapture.style.cssText;
      
      // Forçar o elemento a ter sua altura total visível (sem scroll interno)
      elementToCapture.style.height = 'auto';
      elementToCapture.style.overflow = 'visible';
      
      // Se tiver um container pai com overflow hidden
      const parentContainer = elementToCapture.parentElement;
      let parentOriginalStyle = '';
      if (parentContainer) {
        parentOriginalStyle = parentContainer.style.cssText;
        parentContainer.style.height = 'auto';
        parentContainer.style.overflow = 'visible';
      }

      // Pequeno delay para a página renderizar com a altura expandida
      await new Promise(r => setTimeout(r, 100));
      
      const { toPng } = await import('html-to-image');
      
      const image = await toPng(elementToCapture, {
        quality: 1,
        backgroundColor: '#FAFAF7',
        pixelRatio: 2,
        height: elementToCapture.scrollHeight,
        fontEmbedCSS: '', // Previne o SecurityError de CORS ao ler fontes do Google
        style: {
          transform: 'none', // Prevent transform issues
        }
      });

      // Restaurar estilos originais
      elementToCapture.style.cssText = originalStyle;
      if (parentContainer) {
        parentContainer.style.cssText = parentOriginalStyle;
      }
      
      const link = document.createElement('a');
      link.href = image;
      link.download = `Print-${new Date().toISOString().split('T')[0]}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error: any) {
      console.error('Error capturing screenshot:', error);
      alert('Não foi possível capturar a tela. Detalhes: ' + (error?.message || error));
    } finally {
      setIsCapturing(false);
    }
  };

  return (
    <button
      onClick={handleCapture}
      disabled={isCapturing}
      title="Baixar Print da Tela"
      className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg transition-all hover:bg-emerald-700 hover:scale-105 active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed"
      style={{
        boxShadow: '0 10px 25px -5px rgba(5, 150, 105, 0.4), 0 8px 10px -6px rgba(5, 150, 105, 0.1)'
      }}
    >
      {isCapturing ? (
        <Loader2 className="h-6 w-6 animate-spin" />
      ) : (
        <Camera className="h-6 w-6" />
      )}
    </button>
  );
}
