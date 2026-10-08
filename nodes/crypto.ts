import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { NodeOperationError, INode } from 'n8n-workflow';

/**
 * How a Lime delivery is signed. Version 1 signs the body. Version 2 signs
 * the delivery id, the delivery timestamp and a hash of the body.
 *
 * @public
 * @group Utils
 */
export type SignatureVersion = 'v1' | 'v2';

export const SIGNATURE_VERSION_V1: SignatureVersion = 'v1';
export const SIGNATURE_VERSION_V2: SignatureVersion = 'v2';

/**
 * A version 2 delivery older than this is rejected. Lime retries with the
 * timestamp of the first attempt, so late retries are rejected as well.
 *
 * @public
 * @group Utils
 */
export const DELIVERY_FRESHNESS_WINDOW_SECONDS = 300;

const V1_SIGNATURE_PREFIX = 'sha256=';
const V2_SIGNATURE_PREFIX = 'v2=';

/**
 * @param key - The secret
 * @param data - The signed data
 * @returns The version 1 signature, `sha256=<hex>`
 *
 * @internal
 * @group Utils
 */
function generateHmac(key: string, data: Buffer): string {
	return V1_SIGNATURE_PREFIX + createHmac('sha256', key).update(data).digest('hex');
}

/**
 * @param key - The secret
 * @param deliveryId - The `X-Lime-Delivery-Id` header
 * @param timestamp - The `X-Lime-Delivery-Timestamp` header, unix seconds
 * @param rawBody - The raw request body
 * @returns The version 2 signature, `v2=<hex>` over
 * `v2:<delivery id>:<timestamp>:<sha256 hex of the body>`
 *
 * @internal
 * @group Utils
 */
function generateHmacV2(
	key: string,
	deliveryId: string,
	timestamp: number,
	rawBody: Buffer,
): string {
	const bodyHash = createHash('sha256').update(rawBody).digest('hex');
	const signingBase = `v2:${deliveryId}:${timestamp}:${bodyHash}`;
	return V2_SIGNATURE_PREFIX + createHmac('sha256', key).update(signingBase).digest('hex');
}

/**
 * Constant time comparison. The length check comes first because
 * `timingSafeEqual` requires equal lengths; a signature's length is public.
 *
 * @param expected - The signature computed from the secret
 * @param actual - The signature received with the request
 * @returns `true` if both are equal
 *
 * @internal
 * @group Utils
 */
function hmacEquals(expected: string, actual: string): boolean {
	const expectedBuffer = Buffer.from(expected);
	const actualBuffer = Buffer.from(actual);
	if (expectedBuffer.length !== actualBuffer.length) {
		return false;
	}
	return timingSafeEqual(expectedBuffer, actualBuffer);
}

/**
 * @param key - The secret
 * @param data - The signed data
 * @param comparedHmac - The received version 1 signature
 * @returns `true` if the signature matches the data
 *
 * @public
 * @group Utils
 */
export function verifyHmac(key: string, data: Buffer, comparedHmac: string): boolean {
	return hmacEquals(generateHmac(key, data), comparedHmac);
}

/**
 * Remembers verified version 2 delivery ids for the freshness window, so a
 * delivery sent again inside the window is not processed twice. Lime retries
 * with the same id, so a retry of a processed delivery is dropped as well.
 *
 * Lives in the memory of one n8n process; in queue mode every worker has
 * its own.
 *
 * @public
 * @group Utils
 */
export class DeliveryReplayCache {
	private readonly expiresAt = new Map<string, number>();

	constructor(private readonly maxSize = 10_000) {}

	/**
	 * @param deliveryId - The `X-Lime-Delivery-Id` of the delivery
	 * @param nowMs - The current time in milliseconds
	 * @returns `true` if the id is still remembered
	 */
	has(deliveryId: string, nowMs: number = Date.now()): boolean {
		const expiresAt = this.expiresAt.get(deliveryId);
		return expiresAt !== undefined && expiresAt > nowMs;
	}

	/**
	 * @param deliveryId - The `X-Lime-Delivery-Id` of the delivery
	 * @param ttlSeconds - How long to remember it
	 * @param nowMs - The current time in milliseconds
	 */
	add(deliveryId: string, ttlSeconds: number, nowMs: number = Date.now()): void {
		this.evict(nowMs);
		this.expiresAt.set(deliveryId, nowMs + ttlSeconds * 1000);
	}

	get size(): number {
		return this.expiresAt.size;
	}

	private evict(nowMs: number): void {
		for (const [deliveryId, expiresAt] of this.expiresAt) {
			if (expiresAt <= nowMs) {
				this.expiresAt.delete(deliveryId);
			}
		}
		// Map iterates in insertion order, so the first key is the oldest
		while (this.expiresAt.size >= this.maxSize) {
			const oldest = this.expiresAt.keys().next().value as string;
			this.expiresAt.delete(oldest);
		}
	}
}

/**
 * The replay cache shared by the trigger nodes of this process.
 *
 * @public
 * @group Utils
 */
export const deliveryReplayCache = new DeliveryReplayCache();

/**
 * The headers of a delivery that take part in verification:
 * `X-Lime-Signature`, `X-Lime-Delivery-Id` and `X-Lime-Delivery-Timestamp`.
 *
 * @public
 * @group Utils
 */
export interface DeliveryHeaders {
	signature?: string;
	deliveryId?: string;
	timestamp?: string;
}

/**
 * @property expectedVersion - The version the subscription was created with.
 * A delivery signed with another version is rejected, so a captured version
 * 1 delivery cannot be replayed to a version 2 subscription.
 * @property replayCache - Where verified version 2 delivery ids are kept
 * @property nowSeconds - The current unix time, for tests
 * @property freshnessWindowSeconds - How old a version 2 delivery may be
 *
 * @public
 * @group Utils
 */
export interface VerifyDeliveryOptions {
	expectedVersion: SignatureVersion;
	replayCache?: DeliveryReplayCache;
	nowSeconds?: () => number;
	freshnessWindowSeconds?: number;
}

/**
 * @param signature - The `X-Lime-Signature` header
 * @returns The version from the prefix, or `undefined` for an unknown one
 *
 * @internal
 * @group Utils
 */
function signatureVersionOf(signature: string): SignatureVersion | undefined {
	if (signature.startsWith(V2_SIGNATURE_PREFIX)) {
		return SIGNATURE_VERSION_V2;
	}
	if (signature.startsWith(V1_SIGNATURE_PREFIX)) {
		return SIGNATURE_VERSION_V1;
	}
	return undefined;
}

/**
 * Verifies a delivery from Lime against the given secrets. More than one
 * secret can be given so that deliveries signed with the previous secret
 * are accepted while a rotated secret is rolled out.
 *
 * @param node - The node the delivery belongs to, for error reporting
 * @param headers - The {@link DeliveryHeaders} of the request
 * @param secrets - The secrets to verify against, the current one first
 * @param rawBody - The raw request body, as it was signed
 * @param options - {@link VerifyDeliveryOptions}
 *
 * @throws {NodeOperationError} when the signature is missing, has an unknown
 * format or another version than expected, matches no secret, or, for
 * version 2, when the id or timestamp is missing, the delivery is outside
 * the freshness window or was already processed
 *
 * @public
 * @group Utils
 */
export function verifyDelivery(
	node: INode,
	headers: DeliveryHeaders,
	secrets: string[],
	rawBody: Buffer,
	options: VerifyDeliveryOptions,
): void {
	const { signature } = headers;
	if (!signature) {
		throw new NodeOperationError(
			node,
			'Webhook authentication failed, signature key is missing while secret is present!',
		);
	}

	const version = signatureVersionOf(signature);
	if (version === undefined) {
		throw new NodeOperationError(node, 'Webhook authentication failed, unknown signature format');
	}
	if (version !== options.expectedVersion) {
		throw new NodeOperationError(
			node,
			`Webhook authentication failed, expected a ${options.expectedVersion} signature but received ${version}`,
		);
	}

	if (version === SIGNATURE_VERSION_V1) {
		verifyV1(node, signature, secrets, rawBody);
		return;
	}
	verifyV2(node, headers, secrets, rawBody, options);
}

function verifyV1(node: INode, signature: string, secrets: string[], rawBody: Buffer): void {
	const matches = secrets.some((secret) => hmacEquals(generateHmac(secret, rawBody), signature));
	if (!matches) {
		throw new NodeOperationError(node, 'Webhook authentication failed, signatures do not match');
	}
}

function verifyV2(
	node: INode,
	headers: DeliveryHeaders,
	secrets: string[],
	rawBody: Buffer,
	options: VerifyDeliveryOptions,
): void {
	const { signature, deliveryId, timestamp } = headers;
	if (!deliveryId || !timestamp) {
		throw new NodeOperationError(
			node,
			'Webhook authentication failed, delivery id or timestamp header is missing',
		);
	}
	const timestampSeconds = Number(timestamp);
	if (!Number.isInteger(timestampSeconds)) {
		throw new NodeOperationError(
			node,
			'Webhook authentication failed, delivery timestamp is not a unix timestamp',
		);
	}

	const windowSeconds = options.freshnessWindowSeconds ?? DELIVERY_FRESHNESS_WINDOW_SECONDS;
	const nowSeconds = options.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
	if (Math.abs(nowSeconds - timestampSeconds) > windowSeconds) {
		throw new NodeOperationError(
			node,
			`Webhook authentication failed, delivery timestamp is outside the ${windowSeconds}s freshness window`,
		);
	}

	const matches = secrets.some((secret) =>
		hmacEquals(generateHmacV2(secret, deliveryId, timestampSeconds, rawBody), signature as string),
	);
	if (!matches) {
		throw new NodeOperationError(node, 'Webhook authentication failed, signatures do not match');
	}

	// Only verified deliveries are remembered, so the cache cannot be filled
	// with ids of deliveries that are still to come
	const replayCache = options.replayCache ?? deliveryReplayCache;
	if (replayCache.has(deliveryId, nowSeconds * 1000)) {
		throw new NodeOperationError(
			node,
			`Webhook authentication failed, delivery ${deliveryId} was already processed`,
		);
	}
	replayCache.add(deliveryId, windowSeconds, nowSeconds * 1000);
}

/**
 * Verifies a version 1 request.
 *
 * @param node - The node the request belongs to
 * @param limeSignature - The `X-Lime-Signature` header, as `sha256=<hex>`
 * @param webhookSecret - The secret
 * @param data - The raw payload that was signed
 *
 * @throws {NodeOperationError} when the signature is missing or does not match
 *
 * @public
 * @group Utils
 */
export const verifyRequest = (
	node: INode,
	limeSignature: string,
	webhookSecret: string,
	data: Buffer,
): void => {
	verifyDelivery(node, { signature: limeSignature }, [webhookSecret], data, {
		expectedVersion: SIGNATURE_VERSION_V1,
	});
};
