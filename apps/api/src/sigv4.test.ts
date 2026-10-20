import { expect, test } from 'vitest';
import { sha256Hex, signV4 } from './sigv4';

// Vetores oficiais: suíte de testes do SigV4 da AWS (aws-sig-v4-test-suite: get-vanilla, post-vanilla,
// get-vanilla-query-order-key-case) e os exemplos da documentação do S3 ("Signature Calculations for the
// Authorization Header": GET Object e PUT Object).
const SUITE = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  service: 'service',
};
const SUITE_DATE = new Date('2015-08-30T12:36:00Z');
const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const auth = (signed: string, sig: string, scope = '20150830/us-east-1/service', key = 'AKIDEXAMPLE') =>
  `AWS4-HMAC-SHA256 Credential=${key}/${scope}/aws4_request, SignedHeaders=${signed}, Signature=${sig}`;

test('SHA-256 do corpo vazio', async () => {
  expect(await sha256Hex('')).toBe(EMPTY);
});

test('suíte da AWS: get-vanilla, post-vanilla e query fora de ordem', async () => {
  const get = await signV4(
    { method: 'GET', url: 'https://example.amazonaws.com/', payloadHash: EMPTY },
    SUITE,
    SUITE_DATE,
  );
  expect(get['x-amz-date']).toBe('20150830T123600Z');
  expect(get.authorization).toBe(
    auth('host;x-amz-date', '5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31'),
  );
  const post = await signV4(
    { method: 'POST', url: 'https://example.amazonaws.com/', payloadHash: EMPTY },
    SUITE,
    SUITE_DATE,
  );
  expect(post.authorization).toBe(
    auth('host;x-amz-date', '5da7c1a2acd57cee7505fc6676e4e544621c30862966e37dddb68e92efbe5d6b'),
  );
  const query = await signV4(
    {
      method: 'GET',
      url: 'https://example.amazonaws.com/?Param2=value2&Param1=value1',
      payloadHash: EMPTY,
    },
    SUITE,
    SUITE_DATE,
  );
  expect(query.authorization).toBe(
    auth('host;x-amz-date', 'b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500'),
  );
});

const S3 = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  service: 's3',
};
const S3_DATE = new Date('2013-05-24T00:00:00Z');

test('documentação do S3: GET Object com Range', async () => {
  const h = await signV4(
    {
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      headers: { range: 'bytes=0-9', 'x-amz-content-sha256': EMPTY },
      payloadHash: EMPTY,
    },
    S3,
    S3_DATE,
  );
  expect(h.authorization).toBe(
    auth(
      'host;range;x-amz-content-sha256;x-amz-date',
      'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
      '20130524/us-east-1/s3',
      'AKIAIOSFODNN7EXAMPLE',
    ),
  );
});

test('documentação do S3: PUT Object com caractere codificado no caminho', async () => {
  const body = 'Welcome to Amazon S3.';
  const hash = await sha256Hex(body);
  expect(hash).toBe('44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072');
  const h = await signV4(
    {
      method: 'PUT',
      url: 'https://examplebucket.s3.amazonaws.com/test$file.text',
      headers: {
        date: 'Fri, 24 May 2013 00:00:00 GMT',
        'x-amz-storage-class': 'REDUCED_REDUNDANCY',
        'x-amz-content-sha256': hash,
      },
      payloadHash: hash,
    },
    S3,
    S3_DATE,
  );
  expect(h.authorization).toBe(
    auth(
      'date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class',
      '98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd',
      '20130524/us-east-1/s3',
      'AKIAIOSFODNN7EXAMPLE',
    ),
  );
});
