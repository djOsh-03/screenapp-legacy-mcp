import * as z from "zod/v4";

import { CREDENTIALS_SCHEMA_VERSION } from "../constants.js";

export const storedCredentialsSchema = z.object({
  schemaVersion: z.literal(CREDENTIALS_SCHEMA_VERSION),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).optional(),
  tokenType: z.string().min(1).optional(),
  scope: z.string().optional(),
  expiresAt: z.number().int().positive().optional(),
  oauth: z
    .object({
      tokenEndpoint: z.url(),
      clientId: z.string().min(1),
      clientSecret: z.string().min(1).optional(),
      tokenEndpointAuthMethod: z.string().min(1).optional(),
      resource: z.string().min(1),
    })
    .optional(),
});

export const oauthTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  token_type: z.string().min(1).optional(),
  scope: z.string().optional(),
  expires_in: z.number().int().positive().optional(),
});

export type StoredCredentials = z.infer<typeof storedCredentialsSchema>;

export interface CredentialStore {
  readonly description: string;
  read(): Promise<StoredCredentials | undefined>;
  write(credentials: StoredCredentials): Promise<void>;
}
