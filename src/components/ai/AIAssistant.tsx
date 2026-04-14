
"use client"

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sparkles, Loader2, UtensilsCrossed } from 'lucide-react';
import { dishRecommendationAssistant, DishRecommendationAssistantOutput } from '@/ai/flows/dish-recommendation-assistant-flow';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';

export function AIAssistant() {
  const [preferences, setPreferences] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<DishRecommendationAssistantOutput['recommendations']>([]);
  const [isOpen, setIsOpen] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!preferences.trim()) return;
    
    setLoading(true);
    try {
      const response = await dishRecommendationAssistant({ preferences });
      setResults(response.recommendations);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button className="bg-white border-2 border-accent/20 text-accent hover:bg-accent/5 rounded-full shadow-lg flex gap-2 px-6 h-12 font-bold animate-pulse hover:animate-none">
          <Sparkles className="h-5 w-5" /> Assistente AI
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] h-[80vh] flex flex-col p-0 overflow-hidden bg-[#FAFAF7]">
        <div className="p-6 border-b bg-white">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold flex items-center gap-2">
              <Sparkles className="h-6 w-6 text-accent" /> Sugestões para Você
            </DialogTitle>
            <p className="text-muted-foreground">O que você está com vontade de comer hoje? Diga suas preferências!</p>
          </DialogHeader>
          <form onSubmit={handleSearch} className="flex gap-2 mt-6">
            <Input 
              placeholder="Ex: algo leve, comida apimentada, sugestões populares..." 
              value={preferences}
              onChange={(e) => setPreferences(e.target.value)}
              className="flex-1 bg-muted/50 h-12"
            />
            <Button type="submit" className="bg-accent hover:bg-accent/90 h-12" disabled={loading}>
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Pedir Ajuda'}
            </Button>
          </form>
        </div>

        <ScrollArea className="flex-1 p-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
              <Loader2 className="h-10 w-10 animate-spin text-accent" />
              <p className="text-muted-foreground animate-pulse font-medium">Consultando nosso Chef Digital...</p>
            </div>
          ) : results.length > 0 ? (
            <div className="grid gap-4">
              {results.map((rec, idx) => (
                <Card key={idx} className="border-none shadow-sm hover:shadow-md transition-shadow bg-white overflow-hidden">
                  <CardContent className="p-5 flex gap-4">
                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <UtensilsCrossed className="h-6 w-6 text-primary" />
                    </div>
                    <div className="space-y-1">
                      <h4 className="font-bold text-lg text-primary">{rec.name}</h4>
                      <p className="text-sm leading-relaxed">{rec.description}</p>
                      {rec.reason && (
                        <div className="mt-3 bg-secondary/30 p-2 rounded-md border-l-2 border-primary">
                          <p className="text-xs italic text-primary font-medium">
                            <Sparkles className="inline h-3 w-3 mr-1" /> {rec.reason}
                          </p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-4 opacity-50">
              <UtensilsCrossed className="h-16 w-16 text-muted-foreground" />
              <p className="max-w-[250px]">Diga o que você gosta e eu encontro a combinação perfeita no cardápio!</p>
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
