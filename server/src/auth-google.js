import {createHash} from 'node:crypto';
import {OAuth2Client} from 'google-auth-library';

export function makeGoogle(config) {
  const client = new OAuth2Client(
    config.googleClientId, config.googleClientSecret, config.origin + '/auth/google/callback',
  );
  return {
    authorizationURL({state, nonce, verifier}) {
      return client.generateAuthUrl({
        scope: ['openid', 'email', 'profile'], state, nonce,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256',
        prompt: 'select_account',
      });
    },

    async exchange(code, verifier) {
      const {tokens} = await client.getToken({code, codeVerifier: verifier});
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token, audience: config.googleClientId,
      });
      return ticket.getPayload();
    },
  };
}
