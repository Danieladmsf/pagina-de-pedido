'use client';

/**
 * Runner de disparo em SEGUNDO PLANO.
 *
 * O envio roda no navegador (sequencial, com intervalo anti-bloqueio), mas o
 * estado vive AQUI — num singleton de módulo — e não dentro do componente.
 * Assim, ao trocar de aba (a CampanhasTab desmonta) o disparo CONTINUA, e ao
 * voltar a UI reassina o estado e mostra o progresso/animação de onde parou.
 *
 * A UI lê via useSyncExternalStore(subscribe, getState).
 */
import { uploadImage } from '@/lib/upload';
import { sendCampaign, type SendCampaignResult } from './campaign-service';
import type { ClientLike } from './audience';

export interface DispatchJob {
  empresaId: string;
  getToken: () => Promise<string>;
  targets: ClientLike[];
  message: string;
  imageFile: File | null;
  /** URL remota (quando repetindo uma campanha — imagem já hospedada). */
  imageUrlRemote: string | null;
  loja: string;
  link: string;
  name: string;
  /** Persiste a campanha no histórico (Firestore) — fica a cargo da UI. */
  persist: (args: { result: SendCampaignResult; imageUrl: string | null }) => Promise<void>;
}

export interface RunnerState {
  /** Há um disparo em andamento. */
  active: boolean;
  name: string;
  total: number;
  sent: number;
  failed: number;
  /** Contato sendo enviado agora (para animar a linha). */
  currentId: string | null;
  /** Resultado por contato já processado. */
  doneIds: Record<string, 'sent' | 'failed'>;
  /** Preenchido ao terminar; some quando a UI chama dismiss(). */
  result: SendCampaignResult | null;
  error: string | null;
}

const initial = (): RunnerState => ({
  active: false, name: '', total: 0, sent: 0, failed: 0,
  currentId: null, doneIds: {}, result: null, error: null,
});

let state: RunnerState = initial();
let cancelFlag = false;
const listeners = new Set<() => void>();

function set(patch: Partial<RunnerState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function getState(): RunnerState {
  return state;
}
export function isActive(): boolean {
  return state.active;
}
export function cancelDispatch() {
  if (state.active) cancelFlag = true;
}
/** Limpa o resultado/erro depois que a UI mostrou o resumo. */
export function dismiss() {
  if (state.active) return;
  state = initial();
  listeners.forEach((l) => l());
}

export async function startDispatch(job: DispatchJob): Promise<void> {
  if (state.active) return; // um disparo por vez
  cancelFlag = false;
  state = {
    active: true, name: job.name, total: job.targets.length,
    sent: 0, failed: 0, currentId: null, doneIds: {}, result: null, error: null,
  };
  listeners.forEach((l) => l());

  try {
    let uploadedUrl: string | null = null;
    if (job.imageFile) uploadedUrl = await uploadImage(job.imageFile);
    else if (job.imageUrlRemote && /^https?:/i.test(job.imageUrlRemote)) uploadedUrl = job.imageUrlRemote;

    const result = await sendCampaign({
      empresaId: job.empresaId,
      getToken: job.getToken,
      targets: job.targets,
      message: job.message,
      imageUrl: uploadedUrl,
      loja: job.loja,
      link: job.link,
      onItem: (id, status) => {
        if (status === 'sending') { set({ currentId: id }); return; }
        set({
          currentId: null,
          doneIds: { ...state.doneIds, [id]: status },
          sent: status === 'sent' ? state.sent + 1 : state.sent,
          failed: status === 'failed' ? state.failed + 1 : state.failed,
        });
      },
      shouldCancel: () => cancelFlag,
    });

    set({ result, currentId: null });
    // Histórico é secundário — não derruba o disparo se falhar.
    try { await job.persist({ result, imageUrl: uploadedUrl }); } catch { /* noop */ }
  } catch (e: any) {
    set({ error: e?.message || 'Falha ao disparar.', currentId: null });
  } finally {
    set({ active: false });
  }
}
