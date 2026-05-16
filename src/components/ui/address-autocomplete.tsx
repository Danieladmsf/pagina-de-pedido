'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { MapPin, Loader2 } from 'lucide-react';

interface AddressAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (address: string) => void; // Callback quando o usuário seleciona uma sugestão
  placeholder?: string;
  className?: string;
  id?: string;
  types?: string;
  onBlur?: () => void;
  forceClose?: boolean;
  disableSearch?: boolean;
  locationContext?: string; // Ex: "Cravinhos, SP" - filtra sugestões por cidade
}

interface Prediction {
  description: string;
  placeId: string;
}

const MIN_SEARCH_LENGTH = 2;

export function AddressAutocomplete({ value, onChange, onSelect, placeholder, className, id, types, onBlur, forceClose, disableSearch, locationContext }: AddressAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<Prediction[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Fechar dropdown ao clicar fora
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fechar dropdown de forma forçada se a prop forceClose for ativada (ex: auto-calculado)
  useEffect(() => {
    if (forceClose) {
      setIsOpen(false);
      setSuggestions([]);
    }
  }, [forceClose]);

  const fetchSuggestions = async (input: string) => {
    const query = input.trim();
    const hasAddressContext = /\b(rua|r\.|avenida|av\.|av|rodovia|travessa|alameda|estrada|pra[çc]a)\b/i.test(query);
    if (disableSearch || query.length < MIN_SEARCH_LENGTH) {
      setSuggestions([]);
      setIsOpen(false);
      setErrorMessage('');
      return;
    }

    if (!types && !hasAddressContext && query.length < 4) {
      setSuggestions([]);
      setIsOpen(false);
      setErrorMessage('');
      return;
    }

    setLoading(true);
    setErrorMessage('');
    try {
      const typesParam = types ? `&types=${encodeURIComponent(types)}` : '';
      const contextParam = locationContext ? `&context=${encodeURIComponent(locationContext)}` : '';
      const res = await fetch(`/api/places-autocomplete?input=${encodeURIComponent(query)}${typesParam}${contextParam}`);
      const data = await res.json();
      if (!res.ok) {
        console.warn('[AddressAutocomplete] API retornou erro:', data?.error || res.statusText);
        setSuggestions([]);
        setIsOpen(false);
        setErrorMessage(data?.error || 'Nao foi possivel buscar enderecos. Verifique a API Places no Google Cloud.');
        return;
      }
      if (data.predictions && data.predictions.length > 0) {
        setSuggestions(data.predictions);
        setIsOpen(true);
      } else {
        setSuggestions([]);
        setIsOpen(false);
      }
    } catch (error) {
      console.warn('[AddressAutocomplete] Erro na API:', error);
      setSuggestions([]);
      setErrorMessage('Nao foi possivel buscar enderecos agora.');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    onChange(val);
    setErrorMessage('');

    // Debounce de 400ms para não fazer muitas requisições
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchSuggestions(val);
    }, 400);
  };

  const handleSelect = (prediction: Prediction) => {
    onChange(prediction.description);
    setIsOpen(false);
    setSuggestions([]);
    // Disparar callback de seleção para cálculos externos
    onSelect?.(prediction.description);
  };

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          id={id}
          value={value}
          onChange={handleInputChange}
          onFocus={() => suggestions.length > 0 && setIsOpen(true)}
          onBlur={onBlur}
          placeholder={placeholder || 'Digite o endereço...'}
          className={`pl-9 ${className || ''}`}
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {isOpen && suggestions.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {suggestions.map((prediction, index) => (
            <button
              key={prediction.placeId || index}
              type="button"
              className="w-full text-left px-3 py-2.5 text-sm hover:bg-slate-50 flex items-start gap-2 border-b last:border-0 transition-colors"
              onClick={() => handleSelect(prediction)}
            >
              <MapPin className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <span className="leading-snug">{prediction.description}</span>
            </button>
          ))}
          <div className="px-3 py-1.5 text-[10px] text-muted-foreground text-right bg-slate-50">
            Powered by Google
          </div>
        </div>
      )}

      {!isOpen && errorMessage && (
        <div className="absolute z-50 w-full mt-1 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700 shadow">
          {errorMessage}
        </div>
      )}
    </div>
  );
}
