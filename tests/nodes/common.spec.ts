import { createHash, createHmac } from 'node:crypto';
import { INode } from 'n8n-workflow';
import { DeliveryReplayCache, verifyDelivery, verifyHmac } from '../../nodes/crypto';

describe('hmac', () => {
	describe('verifyHmac', () => {
		const key = 'my-secret-key';
		const data = Buffer.from('hello world');
		const correctHmac = 'sha256=90eb182d8396f16d4341d582047f45c0a97d73388c5377d9ced478a2212295ad';
		const sameLengthWrongHmac = correctHmac.slice(0, -1) + 'e';
		const truncatedHmac = correctHmac.slice(0, -1);

		it('returns true when the HMAC matches', () => {
			expect(verifyHmac(key, data, correctHmac)).toBe(true);
		});

		it('returns false when the HMAC does not match', () => {
			expect(verifyHmac(key, data, 'wrongHmac')).toBe(false);
		});

		it('returns false when the HMAC has the same length but differs', () => {
			expect(verifyHmac(key, data, sameLengthWrongHmac)).toBe(false);
		});

		it('returns false for a truncated HMAC', () => {
			expect(verifyHmac(key, data, truncatedHmac)).toBe(false);
		});

		it('returns false for an empty HMAC', () => {
			expect(verifyHmac(key, data, '')).toBe(false);
		});
	});
});

describe('verifyDelivery', () => {
	const node: INode = {
		id: '1',
		name: 'Lime Forms',
		type: 'limeCrmFormsTrigger',
		typeVersion: 1,
		position: [0, 0],
		parameters: {},
	};
	const secret = 'schhh';
	const rawBody = Buffer.from('hej hej!');
	const deliveryId = '00000000-0000-4000-8000-000000000000';
	const timestamp = 1700000000;
	// Known answer shared with the lime-webhooks and lime-n8n-nodes-crm test suites
	const v2Signature = 'v2=8d5851d803120be490daee860225ef14ca4ac50a094b42d530dc1b90cf612d9d';
	const v1Signature = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');

	const signV2 = (key: string, id: string, ts: number, body: Buffer) => {
		const bodyHash = createHash('sha256').update(body).digest('hex');
		return 'v2=' + createHmac('sha256', key).update(`v2:${id}:${ts}:${bodyHash}`).digest('hex');
	};

	const v2Options = (overrides: Partial<Parameters<typeof verifyDelivery>[4]> = {}) => ({
		expectedVersion: 'v2' as const,
		replayCache: new DeliveryReplayCache(),
		nowSeconds: () => timestamp,
		...overrides,
	});

	describe('version 2', () => {
		it('accepts a delivery signed over id, timestamp and body', () => {
			expect(() =>
				verifyDelivery(
					node,
					{ signature: v2Signature, deliveryId, timestamp: String(timestamp) },
					[secret],
					rawBody,
					v2Options(),
				),
			).not.toThrow();
		});

		it.each<[string, { body?: Buffer; id?: string; ts?: number }]>([
			['body', { body: Buffer.from('hej hej?') }],
			['delivery id', { id: '11111111-0000-4000-8000-000000000000' }],
			['timestamp', { ts: timestamp + 1 }],
		])('rejects a delivery whose %s was tampered with', (_what, change) => {
			const sent = {
				signature: v2Signature,
				deliveryId: change.id ?? deliveryId,
				timestamp: String(change.ts ?? timestamp),
			};
			expect(() =>
				verifyDelivery(node, sent, [secret], change.body ?? rawBody, v2Options()),
			).toThrow('Webhook authentication failed, signatures do not match');
		});

		it('rejects a delivery signed with another secret', () => {
			const signature = signV2('other', deliveryId, timestamp, rawBody);
			expect(() =>
				verifyDelivery(
					node,
					{ signature, deliveryId, timestamp: String(timestamp) },
					[secret],
					rawBody,
					v2Options(),
				),
			).toThrow('Webhook authentication failed, signatures do not match');
		});

		it('accepts a delivery signed with the previous secret', () => {
			const signature = signV2('previous', deliveryId, timestamp, rawBody);
			expect(() =>
				verifyDelivery(
					node,
					{ signature, deliveryId, timestamp: String(timestamp) },
					[secret, 'previous'],
					rawBody,
					v2Options(),
				),
			).not.toThrow();
		});

		it.each([
			['delivery id', { deliveryId: undefined }],
			['timestamp', { timestamp: undefined }],
		])('rejects a delivery without a %s header', (_what, missing) => {
			expect(() =>
				verifyDelivery(
					node,
					{ signature: v2Signature, deliveryId, timestamp: String(timestamp), ...missing },
					[secret],
					rawBody,
					v2Options(),
				),
			).toThrow('Webhook authentication failed, delivery id or timestamp header is missing');
		});

		it('rejects a timestamp that is not a unix timestamp', () => {
			expect(() =>
				verifyDelivery(
					node,
					{ signature: v2Signature, deliveryId, timestamp: '2023-11-14T22:13:20Z' },
					[secret],
					rawBody,
					v2Options(),
				),
			).toThrow('Webhook authentication failed, delivery timestamp is not a unix timestamp');
		});

		it.each([
			['older', timestamp + 301],
			['newer', timestamp - 301],
		])('rejects a delivery whose timestamp is more than 300s %s than now', (_when, now) => {
			expect(() =>
				verifyDelivery(
					node,
					{ signature: v2Signature, deliveryId, timestamp: String(timestamp) },
					[secret],
					rawBody,
					v2Options({ nowSeconds: () => now }),
				),
			).toThrow(
				'Webhook authentication failed, delivery timestamp is outside the 300s freshness window',
			);
		});

		it('accepts a delivery at the edge of the freshness window', () => {
			expect(() =>
				verifyDelivery(
					node,
					{ signature: v2Signature, deliveryId, timestamp: String(timestamp) },
					[secret],
					rawBody,
					v2Options({ nowSeconds: () => timestamp + 300 }),
				),
			).not.toThrow();
		});

		it('rejects a delivery id that was already processed inside the window', () => {
			const options = v2Options();
			const headers = { signature: v2Signature, deliveryId, timestamp: String(timestamp) };

			verifyDelivery(node, headers, [secret], rawBody, options);

			expect(() => verifyDelivery(node, headers, [secret], rawBody, options)).toThrow(
				`Webhook authentication failed, delivery ${deliveryId} was already processed`,
			);
		});

		it('does not remember a delivery that failed verification', () => {
			const options = v2Options();
			const forged = {
				signature: 'v2=' + 'f'.repeat(64),
				deliveryId,
				timestamp: String(timestamp),
			};
			expect(() => verifyDelivery(node, forged, [secret], rawBody, options)).toThrow();

			expect(() =>
				verifyDelivery(
					node,
					{ signature: v2Signature, deliveryId, timestamp: String(timestamp) },
					[secret],
					rawBody,
					options,
				),
			).not.toThrow();
		});

		it('rejects a version 1 signature for a version 2 subscription', () => {
			expect(() =>
				verifyDelivery(node, { signature: v1Signature }, [secret], rawBody, v2Options()),
			).toThrow('Webhook authentication failed, expected a v2 signature but received v1');
		});
	});

	describe('version 1', () => {
		it('accepts a delivery signed over the body', () => {
			expect(() =>
				verifyDelivery(node, { signature: v1Signature }, [secret], rawBody, {
					expectedVersion: 'v1',
				}),
			).not.toThrow();
		});

		it('accepts a delivery signed with the previous secret', () => {
			const signature = 'sha256=' + createHmac('sha256', 'previous').update(rawBody).digest('hex');
			expect(() =>
				verifyDelivery(node, { signature }, [secret, 'previous'], rawBody, {
					expectedVersion: 'v1',
				}),
			).not.toThrow();
		});

		it('rejects a version 2 signature for a version 1 subscription', () => {
			expect(() =>
				verifyDelivery(
					node,
					{ signature: v2Signature, deliveryId, timestamp: String(timestamp) },
					[secret],
					rawBody,
					{ expectedVersion: 'v1' },
				),
			).toThrow('Webhook authentication failed, expected a v1 signature but received v2');
		});

		it('rejects a signature with an unknown prefix', () => {
			expect(() =>
				verifyDelivery(node, { signature: 'md5=abc' }, [secret], rawBody, {
					expectedVersion: 'v1',
				}),
			).toThrow('Webhook authentication failed, unknown signature format');
		});
	});
});

describe('DeliveryReplayCache', () => {
	it('forgets a delivery id once its window has passed', () => {
		const cache = new DeliveryReplayCache();
		cache.add('a', 300, 0);

		expect(cache.has('a', 299_000)).toBe(true);
		expect(cache.has('a', 300_000)).toBe(false);
	});

	it('drops the oldest ids when it is full', () => {
		const cache = new DeliveryReplayCache(2);
		cache.add('a', 300, 0);
		cache.add('b', 300, 1);
		cache.add('c', 300, 2);

		expect(cache.has('a', 3)).toBe(false);
		expect(cache.has('b', 3)).toBe(true);
		expect(cache.has('c', 3)).toBe(true);
		expect(cache.size).toBe(2);
	});
});
