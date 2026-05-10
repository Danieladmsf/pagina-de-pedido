import crypto from 'crypto';
import { firebaseConfig } from '@/firebase/config';
import { ApiError } from '@/lib/firebase-auth-rest';

type FirestoreValue =
  | { nullValue: null }
  | { stringValue: string }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } };

const FIRESTORE_BASE_URL = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents`;

function encodePath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function toFirestoreValue(value: unknown): FirestoreValue {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } };
  }
  if (typeof value === 'object') {
    return { mapValue: { fields: toFirestoreFields(value as Record<string, unknown>) } };
  }
  return { stringValue: String(value) };
}

function toFirestoreFields(data: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(data)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, toFirestoreValue(value)]),
  );
}

function fromFirestoreValue(value: any): any {
  if (!value || typeof value !== 'object') return null;
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(fromFirestoreValue);
  if ('mapValue' in value) return fromFirestoreFields(value.mapValue.fields || {});
  return null;
}

function fromFirestoreFields(fields: Record<string, any>) {
  return Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [key, fromFirestoreValue(value)]));
}

function headers(idToken?: string) {
  return {
    'Content-Type': 'application/json',
    ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
  };
}

export async function getFirestoreDocument<T extends Record<string, any>>(path: string, idToken?: string): Promise<T | null> {
  const response = await fetch(`${FIRESTORE_BASE_URL}/${encodePath(path)}`, {
    method: 'GET',
    headers: headers(idToken),
    cache: 'no-store',
  });

  if (response.status === 404) return null;

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, data?.error?.message || 'Erro ao ler dados no Firestore.', data);
  }

  const id = String(data.name || '').split('/').pop();
  return { id, ...fromFirestoreFields(data.fields || {}) } as unknown as T;
}

export async function setFirestoreDocument(path: string, data: Record<string, any>, idToken?: string) {
  const response = await fetch(`${FIRESTORE_BASE_URL}/${encodePath(path)}`, {
    method: 'PATCH',
    headers: headers(idToken),
    body: JSON.stringify({ fields: toFirestoreFields(data) }),
  });

  const responseData = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, responseData?.error?.message || 'Erro ao salvar dados no Firestore.', responseData);
  }

  return responseData;
}

export async function patchFirestoreDocumentFields(
  path: string,
  data: Record<string, any>,
  fieldPaths: string[],
  idToken?: string,
) {
  const url = new URL(`${FIRESTORE_BASE_URL}/${encodePath(path)}`);
  fieldPaths.forEach((fieldPath) => url.searchParams.append('updateMask.fieldPaths', fieldPath));

  const response = await fetch(url.toString(), {
    method: 'PATCH',
    headers: headers(idToken),
    body: JSON.stringify({ fields: toFirestoreFields(data) }),
  });

  const responseData = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, responseData?.error?.message || 'Erro ao atualizar dados no Firestore.', responseData);
  }

  return responseData;
}

export async function createFirestoreDocument(collectionPath: string, data: Record<string, unknown>, idToken?: string) {
  const documentId = crypto.randomUUID();
  await setFirestoreDocument(`${collectionPath}/${documentId}`, { ...data, id: documentId }, idToken);
  return documentId;
}
