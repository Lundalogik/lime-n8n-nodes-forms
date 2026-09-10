import { LimeFormsApi } from '../../credentials/LimeFormsApi.credentials';

describe.each([['LimeFormsApi', new LimeFormsApi()]])(
	'%s credential webhook secret field',
	(_name, credential) => {
		const field = credential.properties.find((property) => property.name === 'webhookSecret');

		it('is an optional, masked string field', () => {
			expect(field).toBeDefined();
			expect(field!.type).toBe('string');
			expect(field!.required).toBeUndefined();
			expect(field!.typeOptions?.password).toBe(true);
		});

		it('tells the user how to generate a strong secret', () => {
			expect(field!.default).toBe('');
			expect(field!.description).toContain('openssl rand -hex 32');
		});
	},
);
