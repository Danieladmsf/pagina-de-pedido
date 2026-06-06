/**
 * Certificado público usado pelo QZ Tray para impressão silenciosa.
 *
 * É PÚBLICO por natureza (é só o certificado, não a chave privada) — pode ficar
 * versionado e exposto ao navegador. A chave PRIVADA correspondente fica apenas
 * na env var `QZ_PRIVATE_KEY` (servidor) e é usada em /api/qz-sign.
 *
 * O mesmo conteúdo abaixo é distribuído como `override.crt` para o QZ Tray de
 * cada cliente (via instalar-impressao-automatica.bat), o que faz o QZ confiar
 * nas requisições assinadas por nós e NÃO exibir o aviso de permissão.
 *
 * Para girar o par de chaves:
 *   openssl req -x509 -newkey rsa:2048 -keyout qz/private-key.pem \
 *     -out qz/digital-certificate.txt -days 7300 -nodes -subj "/CN=PolarisPDV/O=PolarisPDV"
 */
export const QZ_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIIDNTCCAh2gAwIBAgIUWT0eyyJy5HFea2HOOvvC46oba0QwDQYJKoZIhvcNAQEL
BQAwKjETMBEGA1UEAwwKUG9sYXJpc1BEVjETMBEGA1UECgwKUG9sYXJpc1BEVjAe
Fw0yNjA2MDYxMzA4NTRaFw00NjA2MDExMzA4NTRaMCoxEzARBgNVBAMMClBvbGFy
aXNQRFYxEzARBgNVBAoMClBvbGFyaXNQRFYwggEiMA0GCSqGSIb3DQEBAQUAA4IB
DwAwggEKAoIBAQDUEnkYIrFkd3jhZG/28W6CrhHv+8jYeKZUbZN1Ev/E1KdIGQ1F
c4xUJ0NAVq5uWJJP6K5R9vAGUsmWmwU5/COs6YrHS153n15NdBWm70ZrjvyL41BL
Fi2DAfZGck1yvuNZL90A0Fo0pdJLEWpSR0NBPrKHoe9+5ZvzORC9QyVI0DKcC/eE
sJC8JlmJsmumHBrguE+7ujblBzHb4P7h5sRKV2ZScG7+oyfyuDBaW1qUL+9Ya2le
iw9yM94MohqZkIE+CnZ/yxUzpkiV6i7L0hSQsavKvQrKR/xEdkLGSchTod8JpPEu
YiwpJJOToJEsBkfGQ3bcMLpPx2KxLhSkj8pFAgMBAAGjUzBRMB0GA1UdDgQWBBQs
b/A6T/Z7pADetxD0PE6T4r7w5jAfBgNVHSMEGDAWgBQsb/A6T/Z7pADetxD0PE6T
4r7w5jAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQALiVrcpwCj
r6pMQYApY5q/b/uhKlRYb+HIHTRctsZSTWmMAxyPLL+TPNX/+B9BSrYTfVqpoyHj
7XT8HG2L0JcgBpUcRxp4kHxDxLqpDsZ+OnCDWt50aqLzs4DUsFFwBy8DjSw5bPkk
l39apnepQ9ehQuq82RGlZRaQdkm4R4hQ7kN9EDiiH5YpPnRXyrDZOOaB3qdPMHy8
3lN5foZBed4JqmYXeW+HBG159tU4R4vz1FqdQ61aIIQxhgKIK89xy9EbE6m9ZTEe
nKBJzuPznY18sCEoQ3uWG5TVZyvjzVNkdpI5KOeZOgqWOylwQPhWgisdf6GtvVA6
KKupa8nH/svd
-----END CERTIFICATE-----`;
