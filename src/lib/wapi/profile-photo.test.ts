import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeProfilePhotoLoader } from '@/lib/wapi/profile-photo';

describe('makeProfilePhotoLoader', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('envia o ownerId resolvido, e nao o uid do operador, como empresaId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ link: 'https://example.test/avatar.jpg' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = {
      uid: 'operator-1',
      getIdToken: vi.fn().mockResolvedValue('firebase-token'),
    };

    const loadPhoto = makeProfilePhotoLoader(user, 'owner-1');
    const result = await loadPhoto('+55 (11) 98888-7766');

    expect(result).toBe('https://example.test/avatar.jpg');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, requestInit] = fetchMock.mock.calls[0];
    expect(JSON.parse(requestInit.body)).toEqual({
      empresaId: 'owner-1',
      phone: '5511988887766',
    });
  });
});
