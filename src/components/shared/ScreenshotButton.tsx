'use client';

import React, { useState } from 'react';
import { Camera, Download, Loader2 } from 'lucide-react';
import html2canvas from 'html2canvas';

export default function ScreenshotButton() {
  const [isCapturing, setIsCapturing] = useState(false);

  const handleCapture = async () => {
    try {
      setIsCapturing(true);
      
      // Select the main element to capture, fallback to body
      const elementToCapture = document.querySelector('main') || document.body;
      
      const canvas = await html2canvas(elementToCapture, {
        scale: 2, // High quality
        useCORS: true, // Allow cross-origin images to be captured
        logging: false,
        backgroundColor: '#FAFAF7', // Default background
      });

      const image = canvas.toDataURL('image/png');
      
      // Create a temporary link to download the image
      const link = document.createElement('a');
      link.href = image;
      link.download = `Print-${new Date().toISOString().split('T')[0]}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error('Error capturing screenshot:', error);
      alert('Não foi possível capturar a tela. Tente novamente.');
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
