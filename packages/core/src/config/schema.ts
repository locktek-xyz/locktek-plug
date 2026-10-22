import { z } from 'zod';
import { isRegisteredChain, listRegisteredChains } from './chains.js';

/** Zod schema that validates and normalises Locktek constructor options. */
export const locktekConfigSchema = z
  .object({
    chains: z
      .array(z.string())
      .min(1, 'At least one chain is required')
      .refine(
        (chains) => chains.every(isRegisteredChain),
        (chains) => ({
          message: `Invalid chain(s): ${chains.filter((c) => !isRegisteredChain(c)).join(', ')}. Valid chains: ${listRegisteredChains().join(', ')}`,
        }),
      ),
    defaultChain: z.string().optional(),
    encryptionKey: z.string().min(16).optional(),
    rpc: z.record(z.string(), z.string().url()).optional(),
    testnet: z.boolean().optional().default(true),
  })
  /**
   * An omitted `defaultChain` means "the first chain I configured".
   *
   * It must not fall back to a fixed chain: a hardcoded default rejects every
   * configuration that does not happen to include that one chain — including the
   * documented mainnet setup — and reports it as an error about a `defaultChain`
   * the caller never set. The default has to be derived from the caller's input.
   */
  .transform((config) => ({
    ...config,
    defaultChain: config.defaultChain ?? config.chains[0]!,
  }))
  .refine(
    (config) => config.chains.includes(config.defaultChain),
    (config) => ({
      message: `defaultChain '${config.defaultChain}' must be one of the configured chains: ${config.chains.join(', ')}`,
    }),
  );

/** Validated configuration object produced by {@link locktekConfigSchema}. */
export type LocktekConfig = z.infer<typeof locktekConfigSchema>;
