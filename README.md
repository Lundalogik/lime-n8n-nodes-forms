# @limetech/n8n-nodes-lime-forms

This is an n8n community node. It lets you use Lime CRM Forms in your n8n workflows.

[Lime Forms](https://www.lime-technologies.com/) is a form-building product from Lime Technologies. This package lets you trigger n8n workflows when a form is submitted and retrieve receipts for submissions.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

[Installation](#installation)
[Operations](#operations)
[Credentials](#credentials)
[Compatibility](#compatibility)
[Resources](#resources)
[Development](#development)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation and install `@limetech/n8n-nodes-lime-forms`.

## Operations

### Lime CRM Forms Trigger

Starts a workflow when a monitored Lime Forms form receives a submission. The trigger registers a webhook in Lime Forms, verifies the HMAC signature of every delivery with the webhook secret configured in the credential.

### Lime CRM Forms

- **Receipt**: get the receipt PDF for a submission, either the submission receipt or the signing receipt. Requires Lime CRM Forms 3.x or later.

## Credentials

Create a **Lime CRM Forms API** credential with:

| Field      | Description                                                                       |
| ---------- | --------------------------------------------------------------------------------- |
| Server URL | The URL of your Lime Forms instance, e.g. `https://instance.lime-forms.com`       |
| API Key    | API key generated in Lime Forms (available in the Lime Forms admin settings page) |

Requests are authenticated with an `Authorization: Bearer <token>` header, which n8n adds automatically. The credential is verified against the `/api/v1/external-integrations/ping` endpoint of your instance when you save it.

To use the trigger, also set the optional **Webhook Secret** in the credential; Lime Forms signs deliveries with it. Use a strong value, e.g. generated with `openssl rand -hex 32`.

## Compatibility

Requires n8n with `n8n-workflow` 2.9 or later. Node.js 24 is used for local development.

## Resources

- [Lime CRM node reference](https://platform.docs.lime-crm.com/en/latest/workflows-and-integrations/node-reference/)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Lime Technologies](https://www.lime-technologies.com/)

## Development

```bash
npm ci
npm run build   # compile to dist/
npm test        # jest unit tests
npm run lint    # n8n community node lint rules
npm run knip    # dead code check
```

## License

[MIT](LICENSE)
