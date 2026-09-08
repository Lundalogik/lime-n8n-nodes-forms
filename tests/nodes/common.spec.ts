import { verifyHmac } from '../../nodes/crypto';

describe('hmac', () => {
	describe('verifyHmac', () => {
		const key = 'my-secret-key';
		const data = Buffer.from('hello world');
		const correctHmac = 'sha256=90eb182d8396f16d4341d582047f45c0a97d73388c5377d9ced478a2212295ad';

		it('returns true when the HMAC matches', () => {
			expect(verifyHmac(key, data, correctHmac)).toBe(true);
		});

		it('returns false when the HMAC does not match', () => {
			expect(verifyHmac(key, data, 'wrongHmac')).toBe(false);
		});
	});
});
