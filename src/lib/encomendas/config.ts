// Config da página de Encomendas, derivada do perfil da loja (store_profiles/{uid}).
// O protótipo usava um objeto STORE estático; aqui a fonte é o storeProfile real,
// com fallbacks seguros para que a página funcione mesmo antes da aba admin existir.

import { type EncomendaContent, mergeContent } from './content';
import { type EncomendaCatalog, mergeCatalog } from './catalog';

export interface EncomendaConfig {
  name: string;
  tagline: string;
  city: string;
  whatsapp: string;        // formatado p/ exibir, ex.: "(00) 90000-0000"
  whatsappDigits: string;  // normalizado p/ wa.me, ex.: "5599999999999"
  instagram: string;
  pixKey: string;
  sinalPercent: number;    // entrada/sinal configurável pelo lojista
  minDays: number;         // antecedência mínima da encomenda
  daysLabel: string;       // dias de funcionamento
  hours: string;
  logoUrl: string;         // logo real da loja (general.logoUrl), se houver
  logoEmoji: string;       // fallback visual quando não há logo
  content: EncomendaContent; // textos + fotos editáveis da landing
  catalog: EncomendaCatalog; // produtos reais (tamanhos/recheios/tortas/docinhos...)
  // Taxa de entrega: MESMAS fontes do cardápio (MenuPageClient → CartDrawer) e do
  // PDV (NovoPedidoTab). O wizard envia isso ao /api/delivery-fee — ver memória
  // "delivery-fee-two-entry-points": manter o payload em sincronia nos 3 lugares.
  storeAddress: string;
  deliveryFeeRules: any[];      // faixas por KM (fees.feeRules)
  customAddressRules: any[];    // regras por bairro/rua ("Taxas por Bairro")
}

// Normaliza um telefone BR para o formato do wa.me (DDI 55 + DDD + número, só dígitos).
export function normalizeWhatsapp(raw?: string): string {
  const digits = (raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

// `profile` é o objeto já achatado por fetchStoreProfile (REST do Firestore).
export function buildEncomendaConfig(profile: any): EncomendaConfig {
  const general = profile?.general || {};
  const enc = profile?.encomendas || {};
  const cities: string[] = general.deliveryCities || profile?.fees?.deliveryCities || [];

  const whatsapp = general.whatsapp || general.phone || '';

  return {
    name: general.name || 'Nossa Confeitaria',
    tagline: enc.tagline || 'Encomendas feitas à mão para adoçar seus momentos.',
    city: enc.city || cities[0] || '',
    whatsapp,
    whatsappDigits: normalizeWhatsapp(whatsapp),
    instagram: enc.instagram || general.instagram || '',
    // Reaproveita a chave PIX do cartão se a loja ainda não definir uma específica.
    pixKey: enc.pixKey || profile?.creditPixKey || '',
    sinalPercent: typeof enc.sinalPercent === 'number' ? enc.sinalPercent : 30,
    minDays: typeof enc.minDays === 'number' ? enc.minDays : 3,
    daysLabel: enc.daysLabel || 'Terça a Sábado',
    hours: enc.hours || '09h às 18h',
    // logo específica da página de encomendas tem prioridade sobre a da loja
    logoUrl: enc.content?.logoUrl || general.logoUrl || '',
    // Sempre vazio: emoji de 4 bytes (surrogate pair) corrompe ao cruzar o
    // boundary RSC server→client (vira U+FFFD). O ícone 🎂 é um literal do
    // bundle do cliente (EMOJI_FALLBACK em EncomendaWizard / '🎂' na Landing).
    logoEmoji: '',
    content: mergeContent(enc.content),
    catalog: mergeCatalog(enc.catalog),
    storeAddress: general.address || '',
    deliveryFeeRules: profile?.fees?.feeRules || profile?.feeRules || [],
    customAddressRules: profile?.fees?.customAddressRules || profile?.customAddressRules || [],
  };
}
